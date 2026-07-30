import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { outboxPendingGauge } from '../config/metrics.js';
import { pool } from '../db/pool.js';
import type { EdgeEventEnvelopeV1 } from '../domain/types.js';
import { OutboxRepository, type ClaimedOutboxRow } from '../repositories/outbox-repository.js';

export class OutboxWorker {
  private running = true;
  private readonly repository = new OutboxRepository();
  private readonly env = getEnv();
  private readonly workerName = this.env.WORKER_NAME || `${this.env.WORKER_KIND}-${hostname()}-${process.pid}`;
  private readonly startedAt = new Date().toISOString();
  private lastHeartbeatAt = 0;

  stop(): void {
    this.running = false;
  }

  async run(): Promise<void> {
    logger.info(
      { enabled: this.env.OUTBOX_WORKER_ENABLED, target: this.env.OUTBOX_TARGET_URL || null },
      'Outbox worker started',
    );
    while (this.running) {
      await this.heartbeat();
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM edge_outbox WHERE status IN ('pending','failed')`,
      );
      outboxPendingGauge.set(Number(count.rows[0]?.count || 0));

      if (!this.env.OUTBOX_WORKER_ENABLED || !this.env.OUTBOX_TARGET_URL) {
        await sleep(5_000);
        continue;
      }

      const rows = await this.repository.claimBatch(20);
      if (rows.length === 0) {
        await sleep(1_000);
        continue;
      }
      // Preserve per-conversation event order. Qualification answer events must reach n8n
      // before the completion event that triggers scoring/routing.
      for (const row of rows) await this.deliver(row);
    }
  }

  private async heartbeat(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < 15_000) return;
    this.lastHeartbeatAt = now;
    await pool.query(
      `INSERT INTO runtime.worker_heartbeats
        (worker_name, worker_kind, process_id, started_at, heartbeat_at, metadata_json)
       VALUES ($1, $2, $3, $4::timestamptz, now(), $5::jsonb)
       ON CONFLICT (worker_name) DO UPDATE SET
        worker_kind=EXCLUDED.worker_kind,
        process_id=EXCLUDED.process_id,
        heartbeat_at=EXCLUDED.heartbeat_at,
        metadata_json=EXCLUDED.metadata_json`,
      [
        this.workerName,
        this.env.WORKER_KIND,
        process.pid,
        this.startedAt,
        JSON.stringify({
          outboxWorkerEnabled: this.env.OUTBOX_WORKER_ENABLED,
          outboxTargetConfigured: Boolean(this.env.OUTBOX_TARGET_URL),
        }),
      ],
    );
  }

  private envelope(row: ClaimedOutboxRow): EdgeEventEnvelopeV1 {
    const payload = row.payload_json || {};
    return {
      schema: 'edge.event.v1',
      outboxId: row.outbox_id,
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      occurredAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
      aggregate: {
        conversationId: row.conversation_id,
        clientRecordId: String(payload.clientRecordId || ''),
        leadRecordId: String(payload.leadRecordId || ''),
        phoneNormalized: String(payload.phoneNormalized || ''),
      },
      payload,
    };
  }

  private async deliver(row: ClaimedOutboxRow): Promise<void> {
    try {
      const response = await fetch(this.env.OUTBOX_TARGET_URL || '', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-edge-event-secret': this.env.OUTBOX_TARGET_SECRET,
          'idempotency-key': row.idempotency_key,
          'x-edge-outbox-id': row.outbox_id,
        },
        body: JSON.stringify(this.envelope(row)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Target returned ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
      if (body.ok !== true) throw new Error('Target did not return ok=true');
      await this.repository.complete(row.outbox_id);
    } catch (error) {
      logger.warn({ error, outboxId: row.outbox_id }, 'Outbox delivery failed');
      await this.repository.fail(row.outbox_id, String(error), row.attempt_count + 1);
    }
  }
}
