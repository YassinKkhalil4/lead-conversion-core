import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

type Db = typeof pool | PoolClient;

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function deterministicEventId(input: {
  provider: string;
  eventType: string;
  payload: unknown;
}): string {
  return `${input.provider}:${input.eventType}:sha256:${sha256Hex(stableJson(input.payload))}`;
}

export function retryDelaySeconds(attemptCount: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) return Math.min(retryAfterSeconds, 3600);
  const boundedAttempt = Math.max(1, Math.min(attemptCount, 10));
  const base = Math.min(3600, 2 ** boundedAttempt);
  const jitter = Math.min(30, base);
  return Math.min(3600, base + randomInt(0, jitter + 1));
}

export interface ClaimedInboxEvent {
  inboxEventId: string;
  provider: string;
  eventType: string;
  dedupeKey: string;
  attemptCount: number;
  payload: Record<string, unknown>;
}

export interface ClaimedJob {
  scheduledJobId: string;
  jobType: string;
  attemptCount: number;
  payload: Record<string, unknown>;
}

export class InboxRepository {
  async receive(input: {
    provider: string;
    eventType: string;
    externalEventId?: string;
    rawBody: Buffer;
    headers: Record<string, unknown>;
    payload: Record<string, unknown>;
    signatureValid: boolean;
    aggregateKey?: string;
  }): Promise<{ inboxEventId: string; duplicate: boolean; dedupeKey: string }> {
    const client = await pool.connect();
    const payloadText = stableJson(input.payload);
    const payloadHash = sha256Hex(payloadText);
    const dedupeKey = input.externalEventId
      ? `${input.provider}:${input.eventType}:${input.externalEventId}`
      : deterministicEventId({ provider: input.provider, eventType: input.eventType, payload: input.payload });
    try {
      await client.query('BEGIN');
      const receipt = await client.query<{ webhook_receipt_id: string }>(
        `INSERT INTO runtime.webhook_receipts
          (provider, dedupe_key, raw_body, raw_body_sha256, payload_hash, signature_valid, headers_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (provider, dedupe_key) DO UPDATE SET provider=EXCLUDED.provider
         RETURNING webhook_receipt_id`,
        [
          input.provider,
          dedupeKey,
          input.rawBody,
          sha256Hex(input.rawBody),
          payloadHash,
          input.signatureValid,
          JSON.stringify(input.headers),
        ],
      );
      const inserted = await client.query<{ inbox_event_id: string }>(
        `INSERT INTO runtime.inbox_events
          (webhook_receipt_id, provider, event_type, external_event_id, dedupe_key,
           aggregate_key, payload_hash, payload_json, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending')
         ON CONFLICT (provider, dedupe_key) DO NOTHING
         RETURNING inbox_event_id`,
        [
          receipt.rows[0]?.webhook_receipt_id,
          input.provider,
          input.eventType,
          input.externalEventId || '',
          dedupeKey,
          input.aggregateKey || '',
          payloadHash,
          JSON.stringify(input.payload),
        ],
      );
      const duplicate = !inserted.rows[0];
      const eventId = inserted.rows[0]?.inbox_event_id || (await client.query<{ inbox_event_id: string }>(
        'SELECT inbox_event_id FROM runtime.inbox_events WHERE provider=$1 AND dedupe_key=$2',
        [input.provider, dedupeKey],
      )).rows[0]?.inbox_event_id;
      if (!eventId) throw new Error('inbox_event_not_found_after_receive');
      await client.query('COMMIT');
      return { inboxEventId: eventId, duplicate, dedupeKey };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(workerId: string, limit = 1, leaseSeconds = 60): Promise<ClaimedInboxEvent[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        inbox_event_id: string;
        provider: string;
        event_type: string;
        dedupe_key: string;
        attempt_count: number;
        payload_json: Record<string, unknown>;
      }>(
        `WITH candidates AS (
          SELECT inbox_event_id
          FROM runtime.inbox_events
          WHERE (status IN ('pending','retryable') AND available_at <= now())
             OR (status='processing' AND lock_expires_at <= now())
          ORDER BY available_at, created_at, inbox_event_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE runtime.inbox_events i
        SET status='processing',
            locked_by=$2,
            locked_at=now(),
            lock_expires_at=now()+make_interval(secs => $3),
            attempt_count=attempt_count+1
        FROM candidates
        WHERE i.inbox_event_id=candidates.inbox_event_id
        RETURNING i.inbox_event_id, i.provider, i.event_type, i.dedupe_key, i.attempt_count, i.payload_json`,
        [limit, workerId, leaseSeconds],
      );
      for (const row of result.rows) {
        await client.query(
          `INSERT INTO runtime.inbox_event_attempts (inbox_event_id, attempt_no, worker_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [row.inbox_event_id, row.attempt_count, workerId],
        );
      }
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        inboxEventId: row.inbox_event_id,
        provider: row.provider,
        eventType: row.event_type,
        dedupeKey: row.dedupe_key,
        attemptCount: row.attempt_count,
        payload: row.payload_json,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(inboxEventId: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.inbox_events
        SET status='processed', locked_by='', locked_at=NULL, lock_expires_at=NULL, completed_at=now()
        WHERE inbox_event_id=$1
        RETURNING inbox_event_id, attempt_count
      )
      UPDATE runtime.inbox_event_attempts a
      SET outcome='processed', finished_at=now()
      FROM updated
      WHERE a.inbox_event_id=updated.inbox_event_id
        AND a.attempt_no=updated.attempt_count`,
      [inboxEventId],
    );
  }

  async retry(inboxEventId: string, error: string): Promise<void> {
    const current = await pool.query<{ attempt_count: number; max_attempts: number }>(
      'SELECT attempt_count, max_attempts FROM runtime.inbox_events WHERE inbox_event_id=$1',
      [inboxEventId],
    );
    const row = current.rows[0];
    if (!row) throw new Error(`inbox_event_not_found:${inboxEventId}`);
    if (row.attempt_count >= row.max_attempts) {
      await this.deadLetter(inboxEventId, error);
      return;
    }
    const retryDelay = retryDelaySeconds(row.attempt_count);
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.inbox_events
        SET status='retryable', locked_by='', locked_at=NULL, lock_expires_at=NULL,
            available_at=now()+make_interval(secs => $2), last_error=$3
        WHERE inbox_event_id=$1
        RETURNING inbox_event_id, attempt_count
      )
      UPDATE runtime.inbox_event_attempts a
      SET outcome='retryable', error_message=$3, finished_at=now()
      FROM updated
      WHERE a.inbox_event_id=updated.inbox_event_id
        AND a.attempt_no=updated.attempt_count`,
      [inboxEventId, retryDelay, error.slice(0, 4000)],
    );
  }

  async deadLetter(inboxEventId: string, reason: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.inbox_events
        SET status='dead_lettered', locked_by='', locked_at=NULL, lock_expires_at=NULL, last_error=$2
        WHERE inbox_event_id=$1
        RETURNING inbox_event_id, payload_json, attempt_count
      ), dead_letter AS (
        INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
        SELECT 'runtime.inbox_events', inbox_event_id, $2, payload_json FROM updated
      )
      UPDATE runtime.inbox_event_attempts a
      SET outcome='dead_lettered', error_message=$2, finished_at=now()
      FROM updated
      WHERE a.inbox_event_id=updated.inbox_event_id
        AND a.attempt_no=updated.attempt_count`,
      [inboxEventId, reason.slice(0, 4000)],
    );
  }

  async ignore(inboxEventId: string, reason: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.inbox_events
        SET status='ignored', ignored_reason=$2, locked_by='', locked_at=NULL, lock_expires_at=NULL, completed_at=now()
        WHERE inbox_event_id=$1
        RETURNING inbox_event_id, attempt_count
      )
      UPDATE runtime.inbox_event_attempts a
      SET outcome='ignored', error_message=$2, finished_at=now()
      FROM updated
      WHERE a.inbox_event_id=updated.inbox_event_id
        AND a.attempt_no=updated.attempt_count`,
      [inboxEventId, reason.slice(0, 4000)],
    );
  }

  async replay(input: {
    inboxEventId: string;
    operatorId: string;
    reason: string;
    correlationId?: string;
  }): Promise<void> {
    const client = await pool.connect();
    const message = input.reason.slice(0, 4000);
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ inbox_event_id: string; status: string }>(
        `UPDATE runtime.inbox_events
         SET status='pending',
             locked_by='',
             locked_at=NULL,
             lock_expires_at=NULL,
             available_at=now(),
             completed_at=NULL,
             last_error=''
         WHERE inbox_event_id=$1
         RETURNING inbox_event_id, status`,
        [input.inboxEventId],
      );
      if (!updated.rows[0]) throw new Error(`inbox_event_not_found:${input.inboxEventId}`);
      await client.query(
        `INSERT INTO audit.events
          (event_type, actor_type, actor_id, aggregate_type, aggregate_id,
           correlation_id, causation_id, payload_json, before_json, after_json)
         VALUES
          ('runtime.inbox_replay_requested', 'operator', $2, 'runtime.inbox_event', $1::uuid,
           $3, $1, $4::jsonb, NULL, $5::jsonb)`,
        [
          input.inboxEventId,
          input.operatorId,
          input.correlationId || randomUUID(),
          JSON.stringify({ reason: message }),
          JSON.stringify({ status: 'pending' }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export interface ClaimedOutboxCommand {
  outboxCommandId: string;
  commandType: string;
  destination: string;
  idempotencyKey: string;
  attemptCount: number;
  payload: Record<string, unknown>;
}

export class RuntimeOutboxRepository {
  async enqueue(client: Db, input: {
    commandType: string;
    destination: string;
    idempotencyKey: string;
    aggregateKey?: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<string> {
    const result = await client.query<{ outbox_command_id: string }>(
      `INSERT INTO runtime.outbox_commands
        (command_type, destination, idempotency_key, aggregate_key, payload_json, max_attempts)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING outbox_command_id`,
      [
        input.commandType,
        input.destination,
        input.idempotencyKey,
        input.aggregateKey || '',
        JSON.stringify(input.payload),
        input.maxAttempts || 10,
      ],
    );
    const id = result.rows[0]?.outbox_command_id;
    if (!id) throw new Error('outbox_command_not_created');
    return id;
  }

  async claim(workerId: string, limit = 1, leaseSeconds = 60): Promise<ClaimedOutboxCommand[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        outbox_command_id: string;
        command_type: string;
        destination: string;
        idempotency_key: string;
        attempt_count: number;
        payload_json: Record<string, unknown>;
      }>(
        `WITH candidates AS (
          SELECT outbox_command_id
          FROM runtime.outbox_commands
          WHERE (state IN ('pending','retryable') AND available_at <= now())
             OR (state='processing' AND lock_expires_at <= now())
          ORDER BY available_at, created_at, outbox_command_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE runtime.outbox_commands o
        SET state='processing',
            lock_owner=$2,
            locked_at=now(),
            lock_expires_at=now()+make_interval(secs => $3),
            attempt_count=attempt_count+1
        FROM candidates
        WHERE o.outbox_command_id=candidates.outbox_command_id
        RETURNING o.outbox_command_id, o.command_type, o.destination, o.idempotency_key, o.attempt_count, o.payload_json`,
        [limit, workerId, leaseSeconds],
      );
      for (const row of result.rows) {
        await client.query(
          `INSERT INTO runtime.outbox_command_attempts (outbox_command_id, attempt_no, worker_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [row.outbox_command_id, row.attempt_count, workerId],
        );
      }
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        outboxCommandId: row.outbox_command_id,
        commandType: row.command_type,
        destination: row.destination,
        idempotencyKey: row.idempotency_key,
        attemptCount: row.attempt_count,
        payload: row.payload_json,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(outboxCommandId: string, providerMessageId: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.outbox_commands
        SET state='delivered', provider_message_id=$2, completed_at=now(),
            lock_owner='', locked_at=NULL, lock_expires_at=NULL
        WHERE outbox_command_id=$1
        RETURNING outbox_command_id, attempt_count, command_type, payload_json
      ), message_update AS (
        UPDATE app.messages m
        SET provider_message_id=$2, state='accepted'
        FROM updated
        WHERE updated.command_type='whatsapp.send_message'
          AND m.message_id = NULLIF(updated.payload_json->>'messageId', '')::uuid
      ), appointment_update AS (
        UPDATE app.appointments a
        SET calendar_event_id=$2,
            status='confirmed',
            updated_at=now()
        FROM updated
        WHERE updated.command_type='calendar.create_event'
          AND a.appointment_id = NULLIF(updated.payload_json->>'appointmentId', '')::uuid
      )
      UPDATE runtime.outbox_command_attempts a
      SET outcome='delivered', provider_message_id=$2, finished_at=now()
      FROM updated
      WHERE a.outbox_command_id=updated.outbox_command_id
        AND a.attempt_no=updated.attempt_count`,
      [outboxCommandId, providerMessageId],
    );
  }

  async markRetryable(outboxCommandId: string, error: string, retryAfterSeconds?: number): Promise<void> {
    const current = await pool.query<{ attempt_count: number; max_attempts: number; payload_json: Record<string, unknown> }>(
      'SELECT attempt_count, max_attempts, payload_json FROM runtime.outbox_commands WHERE outbox_command_id=$1',
      [outboxCommandId],
    );
    const row = current.rows[0];
    if (!row) throw new Error(`outbox_command_not_found:${outboxCommandId}`);
    const message = error.slice(0, 4000);
    if (row.attempt_count >= row.max_attempts) {
      await pool.query(
        `WITH updated AS (
          UPDATE runtime.outbox_commands
          SET state='dead_lettered', last_error=$2, completed_at=now(),
              lock_owner='', locked_at=NULL, lock_expires_at=NULL
          WHERE outbox_command_id=$1
          RETURNING outbox_command_id, payload_json, attempt_count
        ), dead_letter AS (
          INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
          SELECT 'runtime.outbox_commands', outbox_command_id, $2, payload_json FROM updated
        )
        UPDATE runtime.outbox_command_attempts a
        SET outcome='dead_lettered', error_message=$2, finished_at=now()
        FROM updated
        WHERE a.outbox_command_id=updated.outbox_command_id
          AND a.attempt_no=updated.attempt_count`,
        [outboxCommandId, message],
      );
      return;
    }
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.outbox_commands
        SET state='retryable',
            available_at=now()+make_interval(secs => $2),
            next_attempt_after=now()+make_interval(secs => $2),
            retry_hint_after=CASE WHEN $4::integer IS NULL THEN retry_hint_after ELSE now()+make_interval(secs => $4) END,
            last_error=$3,
            lock_owner='', locked_at=NULL, lock_expires_at=NULL
        WHERE outbox_command_id=$1
        RETURNING outbox_command_id, attempt_count
      )
      UPDATE runtime.outbox_command_attempts a
      SET outcome='retryable', error_message=$3, finished_at=now()
      FROM updated
      WHERE a.outbox_command_id=updated.outbox_command_id
        AND a.attempt_no=updated.attempt_count`,
      [outboxCommandId, retryDelaySeconds(row.attempt_count, retryAfterSeconds), message, retryAfterSeconds ?? null],
    );
  }

  async markPermanentlyFailed(outboxCommandId: string, error: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.outbox_commands
        SET state='permanently_failed', last_error=$2, completed_at=now(),
            lock_owner='', locked_at=NULL, lock_expires_at=NULL
        WHERE outbox_command_id=$1
        RETURNING outbox_command_id, payload_json, attempt_count
      ), dead_letter AS (
        INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
        SELECT 'runtime.outbox_commands', outbox_command_id, $2, payload_json FROM updated
      )
      UPDATE runtime.outbox_command_attempts a
      SET outcome='permanently_failed', error_message=$2, finished_at=now()
      FROM updated
      WHERE a.outbox_command_id=updated.outbox_command_id
        AND a.attempt_no=updated.attempt_count`,
      [outboxCommandId, error.slice(0, 4000)],
    );
  }

  async markDeliveryUnknown(outboxCommandId: string, error: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.outbox_commands
        SET state='delivery_unknown', last_error=$2, lock_owner='', locked_at=NULL, lock_expires_at=NULL
        WHERE outbox_command_id=$1
        RETURNING outbox_command_id, attempt_count
      )
      UPDATE runtime.outbox_command_attempts a
      SET outcome='delivery_unknown', ambiguous=true, error_message=$2, finished_at=now()
      FROM updated
      WHERE a.outbox_command_id=updated.outbox_command_id
        AND a.attempt_no=updated.attempt_count`,
      [outboxCommandId, error.slice(0, 4000)],
    );
  }
}

export class JobRepository {
  async schedule(client: Db, input: {
    jobKey: string;
    jobType: string;
    dueAt: string;
    timezone: string;
    aggregateKey?: string;
    payload?: Record<string, unknown>;
    recurrence?: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<string> {
    const result = await client.query<{ scheduled_job_id: string }>(
      `INSERT INTO runtime.scheduled_jobs
        (job_key, job_type, aggregate_key, payload_json, due_at, timezone, recurrence_json, max_attempts)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6, $7::jsonb, $8)
       ON CONFLICT (job_key) DO UPDATE SET job_key=EXCLUDED.job_key
       RETURNING scheduled_job_id`,
      [
        input.jobKey,
        input.jobType,
        input.aggregateKey || '',
        JSON.stringify(input.payload || {}),
        input.dueAt,
        input.timezone,
        input.recurrence ? JSON.stringify(input.recurrence) : null,
        input.maxAttempts || 10,
      ],
    );
    const id = result.rows[0]?.scheduled_job_id;
    if (!id) throw new Error('scheduled_job_not_created');
    return id;
  }

  async cancel(jobKey: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE runtime.scheduled_jobs
       SET status='cancelled', cancelled_reason=$2
       WHERE job_key=$1 AND status <> 'completed'`,
      [jobKey, reason.slice(0, 4000)],
    );
  }

  async claim(workerId: string, limit = 1, leaseSeconds = 60): Promise<ClaimedJob[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        scheduled_job_id: string;
        job_type: string;
        attempt_count: number;
        payload_json: Record<string, unknown>;
      }>(
        `WITH candidates AS (
          SELECT scheduled_job_id
          FROM runtime.scheduled_jobs
          WHERE due_at <= now()
            AND (
              status IN ('pending','retryable')
              OR (status='processing' AND lock_expires_at <= now())
            )
          ORDER BY due_at, created_at, scheduled_job_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE runtime.scheduled_jobs j
        SET status='processing',
            locked_by=$2,
            locked_at=now(),
            lock_expires_at=now()+make_interval(secs => $3),
            attempt_count=attempt_count+1
        FROM candidates
        WHERE j.scheduled_job_id=candidates.scheduled_job_id
        RETURNING j.scheduled_job_id, j.job_type, j.attempt_count, j.payload_json`,
        [limit, workerId, leaseSeconds],
      );
      for (const row of result.rows) {
        await client.query(
          `INSERT INTO runtime.scheduled_job_attempts (scheduled_job_id, attempt_no, worker_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [row.scheduled_job_id, row.attempt_count, workerId],
        );
      }
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        scheduledJobId: row.scheduled_job_id,
        jobType: row.job_type,
        attemptCount: row.attempt_count,
        payload: row.payload_json,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(scheduledJobId: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.scheduled_jobs
        SET status='completed', completed_at=now(), locked_by='', locked_at=NULL, lock_expires_at=NULL
        WHERE scheduled_job_id=$1
        RETURNING scheduled_job_id, attempt_count
      )
      UPDATE runtime.scheduled_job_attempts a
      SET outcome='completed', finished_at=now()
      FROM updated
      WHERE a.scheduled_job_id=updated.scheduled_job_id
        AND a.attempt_no=updated.attempt_count`,
      [scheduledJobId],
    );
  }

  async retry(scheduledJobId: string, error: string): Promise<void> {
    const current = await pool.query<{ attempt_count: number; max_attempts: number; payload_json: Record<string, unknown> }>(
      'SELECT attempt_count, max_attempts, payload_json FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1',
      [scheduledJobId],
    );
    const row = current.rows[0];
    if (!row) throw new Error(`scheduled_job_not_found:${scheduledJobId}`);
    const message = error.slice(0, 4000);
    if (row.attempt_count >= row.max_attempts) {
      await pool.query(
        `WITH updated AS (
          UPDATE runtime.scheduled_jobs
          SET status='dead_lettered', last_error=$2, completed_at=now(),
              locked_by='', locked_at=NULL, lock_expires_at=NULL
          WHERE scheduled_job_id=$1
          RETURNING scheduled_job_id, payload_json, attempt_count
        ), dead_letter AS (
          INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
          SELECT 'runtime.scheduled_jobs', scheduled_job_id, $2, payload_json FROM updated
        )
        UPDATE runtime.scheduled_job_attempts a
        SET outcome='dead_lettered', error_message=$2, finished_at=now()
        FROM updated
        WHERE a.scheduled_job_id=updated.scheduled_job_id
          AND a.attempt_no=updated.attempt_count`,
        [scheduledJobId, message],
      );
      return;
    }
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.scheduled_jobs
        SET status='retryable',
            due_at=now()+make_interval(secs => $2),
            last_error=$3,
            locked_by='', locked_at=NULL, lock_expires_at=NULL
        WHERE scheduled_job_id=$1
        RETURNING scheduled_job_id, attempt_count
      )
      UPDATE runtime.scheduled_job_attempts a
      SET outcome='retryable', error_message=$3, finished_at=now()
      FROM updated
      WHERE a.scheduled_job_id=updated.scheduled_job_id
        AND a.attempt_no=updated.attempt_count`,
      [scheduledJobId, retryDelaySeconds(row.attempt_count), message],
    );
  }

  async deadLetter(scheduledJobId: string, reason: string): Promise<void> {
    await pool.query(
      `WITH updated AS (
        UPDATE runtime.scheduled_jobs
        SET status='dead_lettered', last_error=$2, completed_at=now(),
            locked_by='', locked_at=NULL, lock_expires_at=NULL
        WHERE scheduled_job_id=$1
        RETURNING scheduled_job_id, payload_json, attempt_count
      ), dead_letter AS (
        INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
        SELECT 'runtime.scheduled_jobs', scheduled_job_id, $2, payload_json FROM updated
      )
      UPDATE runtime.scheduled_job_attempts a
      SET outcome='dead_lettered', error_message=$2, finished_at=now()
      FROM updated
      WHERE a.scheduled_job_id=updated.scheduled_job_id
        AND a.attempt_no=updated.attempt_count`,
      [scheduledJobId, reason.slice(0, 4000)],
    );
  }
}

export class AuditRepository {
  async record(client: Db, input: {
    eventType: string;
    actorType: 'external_user' | 'salesperson' | 'operator' | 'worker' | 'migration' | 'system';
    actorId?: string;
    aggregateType?: string;
    aggregateId?: string;
    correlationId?: string;
    causationId?: string;
    payload?: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): Promise<string> {
    const result = await client.query<{ audit_event_id: string }>(
      `INSERT INTO audit.events
        (event_type, actor_type, actor_id, aggregate_type, aggregate_id,
         correlation_id, causation_id, payload_json, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
       RETURNING audit_event_id`,
      [
        input.eventType,
        input.actorType,
        input.actorId || '',
        input.aggregateType || '',
        input.aggregateId || null,
        input.correlationId || randomUUID(),
        input.causationId || '',
        JSON.stringify(input.payload || {}),
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
      ],
    );
    const id = result.rows[0]?.audit_event_id;
    if (!id) throw new Error('audit_event_not_created');
    return id;
  }
}
