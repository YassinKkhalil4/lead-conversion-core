import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

function commandExists(command: string): boolean {
  try {
    execFileSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasPostgres = ['initdb', 'pg_ctl', 'createdb', 'psql'].every(commandExists);
const describePg = hasPostgres ? describe : describe.skip;

describePg('durable runtime repositories with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-runtime-test.'));
  const dataDir = join(root, 'data');
  const socketDir = root;
  const port = 56_500 + Math.floor(Math.random() * 1000);
  const dbName = 'lead_core_runtime_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    EDGE_SHARED_SECRET: 'test_shared_secret_123456',
    EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
  };

  let db: typeof import('../src/db/pool.js');
  let runtime: typeof import('../src/infrastructure/runtime.js');
  let runtimeWorker: typeof import('../src/worker/runtime-worker.js');

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${socketDir}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
    process.env.DATABASE_URL = databaseUrl;
    process.env.EDGE_SHARED_SECRET = env.EDGE_SHARED_SECRET;
    process.env.EDGE_INTERNAL_SECRET = env.EDGE_INTERNAL_SECRET;
    db = await import('../src/db/pool.js');
    runtime = await import('../src/infrastructure/runtime.js');
    runtimeWorker = await import('../src/worker/runtime-worker.js');
  }, 30_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE
        runtime.inbox_event_attempts,
        runtime.outbox_command_attempts,
        runtime.scheduled_job_attempts,
        runtime.dead_letters,
        runtime.inbox_events,
        runtime.webhook_receipts,
        runtime.outbox_commands,
        runtime.scheduled_jobs,
        audit.events,
        app.leads,
        app.contacts,
        app.projects,
        app.clients
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    try {
      if (db) await db.closePool();
    } finally {
      try {
        execFileSync('pg_ctl', ['-D', dataDir, 'stop'], { stdio: 'ignore' });
      } catch {
        // The test has already failed if PostgreSQL cannot stop; cleanup still continues.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  async function receiveInbox(externalEventId = 'evt-1'): Promise<string> {
    const inbox = new runtime.InboxRepository();
    const receipt = await inbox.receive({
      provider: 'meta',
      eventType: 'message.received',
      externalEventId,
      rawBody: Buffer.from(JSON.stringify({ id: externalEventId, text: 'hello' })),
      headers: { 'x-test': 'yes' },
      payload: { id: externalEventId, text: 'hello' },
      signatureValid: true,
      aggregateKey: '+201000000001',
    });
    return receipt.inboxEventId;
  }

  async function enqueueOutbox(maxAttempts = 10): Promise<string> {
    const outbox = new runtime.RuntimeOutboxRepository();
    return outbox.enqueue(db.pool, {
      commandType: 'whatsapp.send_message',
      destination: '+201000000001',
      idempotencyKey: `message:${maxAttempts}:lead-1:welcome`,
      aggregateKey: 'lead-1',
      payload: { text: 'welcome' },
      maxAttempts,
    });
  }

  it('deduplicates inbound events before business processing creates side effects', async () => {
    const inbox = new runtime.InboxRepository();
    const outbox = new runtime.RuntimeOutboxRepository();
    const first = await receiveInbox('evt-duplicate');
    const second = await inbox.receive({
      provider: 'meta',
      eventType: 'message.received',
      externalEventId: 'evt-duplicate',
      rawBody: Buffer.from('{"id":"evt-duplicate","text":"hello"}'),
      headers: {},
      payload: { id: 'evt-duplicate', text: 'hello' },
      signatureValid: true,
    });

    expect(second.inboxEventId).toBe(first);
    expect(second.duplicate).toBe(true);
    expect((await db.pool.query('SELECT count(*) FROM runtime.inbox_events')).rows[0]?.count).toBe('1');

    const claimed = await inbox.claim('worker-a');
    expect(claimed).toHaveLength(1);
    await outbox.enqueue(db.pool, {
      commandType: 'whatsapp.send_message',
      destination: '+201000000001',
      idempotencyKey: `inbox:${claimed[0]?.inboxEventId}:ack`,
      payload: { text: 'ack' },
    });
    await inbox.complete(first);

    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
    expect(await inbox.claim('worker-b')).toHaveLength(0);
    expect((await db.pool.query('SELECT outcome FROM runtime.inbox_event_attempts WHERE inbox_event_id=$1', [first])).rows[0]?.outcome).toBe('processed');
  });

  it('uses deterministic payload hashes when providers omit stable event IDs', async () => {
    const inbox = new runtime.InboxRepository();
    const first = await inbox.receive({
      provider: 'provider-without-event-id',
      eventType: 'lead.created',
      rawBody: Buffer.from('{"b":2,"a":1}'),
      headers: {},
      payload: { b: 2, a: 1 },
      signatureValid: true,
    });
    const second = await inbox.receive({
      provider: 'provider-without-event-id',
      eventType: 'lead.created',
      rawBody: Buffer.from('{"a":1,"b":2}'),
      headers: {},
      payload: { a: 1, b: 2 },
      signatureValid: true,
    });

    expect(second.inboxEventId).toBe(first.inboxEventId);
    expect(first.dedupeKey).toContain('sha256');
    expect(second.duplicate).toBe(true);
    expect((await db.pool.query('SELECT count(*) FROM runtime.webhook_receipts')).rows[0]?.count).toBe('1');
  });

  it('prevents concurrent inbox claims and recovers expired leases', async () => {
    const inbox = new runtime.InboxRepository();
    const eventId = await receiveInbox('evt-lease');
    const firstClaim = await inbox.claim('worker-a', 1, 60);
    expect(firstClaim.map((row) => row.inboxEventId)).toEqual([eventId]);
    expect(await inbox.claim('worker-b')).toHaveLength(0);

    await db.pool.query(
      "UPDATE runtime.inbox_events SET lock_expires_at=now()-interval '1 second' WHERE inbox_event_id=$1",
      [eventId],
    );
    const recovered = await inbox.claim('worker-b');
    expect(recovered.map((row) => row.inboxEventId)).toEqual([eventId]);
    expect(recovered[0]?.attemptCount).toBe(2);
  });

  it('reschedules retryable inbox failures and dead-letters invalid events', async () => {
    const inbox = new runtime.InboxRepository();
    const retryEventId = await receiveInbox('evt-retry');
    await inbox.claim('worker-a');
    await inbox.retry(retryEventId, 'temporary provider parse failure');

    const retryState = await db.pool.query<{ status: string; delay_seconds: string }>(
      "SELECT status, EXTRACT(EPOCH FROM (available_at-now()))::integer::text AS delay_seconds FROM runtime.inbox_events WHERE inbox_event_id=$1",
      [retryEventId],
    );
    expect(retryState.rows[0]?.status).toBe('retryable');
    expect(Number(retryState.rows[0]?.delay_seconds)).toBeGreaterThan(0);
    expect(await inbox.claim('worker-b')).toHaveLength(0);

    const invalidEventId = await receiveInbox('evt-invalid');
    await inbox.deadLetter(invalidEventId, 'schema validation failed');
    expect((await db.pool.query("SELECT status FROM runtime.inbox_events WHERE inbox_event_id=$1", [invalidEventId])).rows[0]?.status).toBe('dead_lettered');
    expect((await db.pool.query("SELECT count(*) FROM runtime.dead_letters WHERE source_table='runtime.inbox_events'")).rows[0]?.count).toBe('1');
  });

  it('replays inbox events without replacing the original payload', async () => {
    const inbox = new runtime.InboxRepository();
    const inboxEventId = await receiveInbox('evt-replay');
    const before = await db.pool.query<{ payload_hash: string; payload_json: Record<string, unknown> }>(
      'SELECT payload_hash, payload_json FROM runtime.inbox_events WHERE inbox_event_id=$1',
      [inboxEventId],
    );
    await inbox.deadLetter(inboxEventId, 'operator requested validation review');
    await inbox.replay({
      inboxEventId,
      operatorId: 'operator-1',
      reason: 'safe replay after corrected mapping',
      correlationId: 'corr-replay',
    });

    const claimed = await inbox.claim('worker-replay');
    const after = await db.pool.query<{ payload_hash: string; payload_json: Record<string, unknown> }>(
      'SELECT payload_hash, payload_json FROM runtime.inbox_events WHERE inbox_event_id=$1',
      [inboxEventId],
    );
    expect(claimed.map((row) => row.inboxEventId)).toEqual([inboxEventId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='runtime.inbox_replay_requested'")).rows[0]?.count).toBe('1');
  });

  it('inserts outbox commands atomically with business mutations', async () => {
    const outbox = new runtime.RuntimeOutboxRepository();
    const committed = await db.pool.connect();
    try {
      await committed.query('BEGIN');
      const client = await committed.query<{ client_id: string }>(
        "INSERT INTO app.clients (client_key, company_name) VALUES ('client-atomic', 'Atomic Client') RETURNING client_id",
      );
      const clientId = client.rows[0]?.client_id;
      if (!clientId) throw new Error('client_not_created');
      await outbox.enqueue(committed, {
        commandType: 'whatsapp.send_message',
        destination: '+201000000001',
        idempotencyKey: `client:${clientId}:created`,
        aggregateKey: clientId,
        payload: { clientId },
      });
      await committed.query('COMMIT');
    } catch (error) {
      await committed.query('ROLLBACK');
      throw error;
    } finally {
      committed.release();
    }

    const rolledBack = await db.pool.connect();
    try {
      await rolledBack.query('BEGIN');
      const client = await rolledBack.query<{ client_id: string }>(
        "INSERT INTO app.clients (client_key, company_name) VALUES ('client-rollback', 'Rollback Client') RETURNING client_id",
      );
      const clientId = client.rows[0]?.client_id;
      if (!clientId) throw new Error('client_not_created');
      await outbox.enqueue(rolledBack, {
        commandType: 'whatsapp.send_message',
        destination: '+201000000002',
        idempotencyKey: `client:${clientId}:created`,
        aggregateKey: clientId,
        payload: { clientId },
      });
      await rolledBack.query('ROLLBACK');
    } finally {
      rolledBack.release();
    }

    expect((await db.pool.query('SELECT count(*) FROM app.clients')).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
  });

  it('prevents concurrent outbox claims, recovers expired leases, and avoids blind duplicate sends after ambiguous delivery', async () => {
    const outbox = new runtime.RuntimeOutboxRepository();
    const commandId = await enqueueOutbox();
    const firstClaim = await outbox.claim('sender-a', 1, 60);
    expect(firstClaim.map((row) => row.outboxCommandId)).toEqual([commandId]);
    expect(await outbox.claim('sender-b')).toHaveLength(0);

    await db.pool.query(
      "UPDATE runtime.outbox_commands SET lock_expires_at=now()-interval '1 second' WHERE outbox_command_id=$1",
      [commandId],
    );
    const recovered = await outbox.claim('sender-b');
    expect(recovered.map((row) => row.outboxCommandId)).toEqual([commandId]);
    expect(recovered[0]?.attemptCount).toBe(2);

    await outbox.markDeliveryUnknown(commandId, 'provider accepted request but worker crashed before recording id');
    expect(await outbox.claim('sender-c')).toHaveLength(0);
    expect((await db.pool.query('SELECT state FROM runtime.outbox_commands WHERE outbox_command_id=$1', [commandId])).rows[0]?.state).toBe('delivery_unknown');
    expect((await db.pool.query('SELECT outcome, ambiguous FROM runtime.outbox_command_attempts WHERE outbox_command_id=$1 ORDER BY attempt_no DESC LIMIT 1', [commandId])).rows[0]).toEqual({
      outcome: 'delivery_unknown',
      ambiguous: true,
    });
  });

  it('uses bounded increasing outbox retry delays and dead-letters at max attempts', async () => {
    const outbox = new runtime.RuntimeOutboxRepository();
    const commandId = await enqueueOutbox();
    await outbox.claim('sender-a');
    await outbox.markRetryable(commandId, 'temporary provider outage');
    const firstDelay = Number((await db.pool.query(
      "SELECT EXTRACT(EPOCH FROM (available_at-now()))::integer AS seconds FROM runtime.outbox_commands WHERE outbox_command_id=$1",
      [commandId],
    )).rows[0]?.seconds);

    await db.pool.query(
      "UPDATE runtime.outbox_commands SET state='processing', attempt_count=4, lock_owner='sender-a' WHERE outbox_command_id=$1",
      [commandId],
    );
    await outbox.markRetryable(commandId, 'provider still unavailable');
    const laterDelay = Number((await db.pool.query(
      "SELECT EXTRACT(EPOCH FROM (available_at-now()))::integer AS seconds FROM runtime.outbox_commands WHERE outbox_command_id=$1",
      [commandId],
    )).rows[0]?.seconds);
    expect(laterDelay).toBeGreaterThan(firstDelay);
    expect(laterDelay).toBeLessThanOrEqual(3600);

    const maxedCommandId = await enqueueOutbox(1);
    await outbox.claim('sender-max');
    await outbox.markRetryable(maxedCommandId, 'maximum attempts reached');
    expect((await db.pool.query('SELECT state FROM runtime.outbox_commands WHERE outbox_command_id=$1', [maxedCommandId])).rows[0]?.state).toBe('dead_lettered');
    expect((await db.pool.query("SELECT count(*) FROM runtime.dead_letters WHERE source_table='runtime.outbox_commands'")).rows[0]?.count).toBe('1');
  });

  it('prevents duplicate durable jobs and never claims cancelled work', async () => {
    const jobs = new runtime.JobRepository();
    const dueAt = new Date(Date.now() - 1000).toISOString();
    const first = await jobs.schedule(db.pool, {
      jobKey: 'followup:lead-1:slot-1',
      jobType: 'followup',
      dueAt,
      timezone: 'Africa/Cairo',
      payload: { leadId: 'lead-1' },
    });
    const second = await jobs.schedule(db.pool, {
      jobKey: 'followup:lead-1:slot-1',
      jobType: 'followup',
      dueAt,
      timezone: 'Africa/Cairo',
      payload: { leadId: 'lead-1' },
    });
    expect(second).toBe(first);
    expect((await db.pool.query('SELECT count(*) FROM runtime.scheduled_jobs')).rows[0]?.count).toBe('1');
    await jobs.cancel('followup:lead-1:slot-1', 'superseded by operator');
    expect(await jobs.claim('scheduler-a')).toHaveLength(0);
  });

  it('processes durable inbox, outbox, and job work through the runtime worker', async () => {
    const inbox = new runtime.InboxRepository();
    const outbox = new runtime.RuntimeOutboxRepository();
    const jobs = new runtime.JobRepository();
    const inboxEventId = await receiveInbox('evt-worker');
    const outboxCommandId = await enqueueOutbox();
    const scheduledJobId = await jobs.schedule(db.pool, {
      jobKey: 'report:daily:client-1:2026-07-30',
      jobType: 'daily_report',
      dueAt: new Date(Date.now() - 1000).toISOString(),
      timezone: 'Africa/Cairo',
      payload: { client: 'client-1' },
    });

    const worker = new runtimeWorker.RuntimeWorker(
      {
        processInbox: async () => ({ outcome: 'processed' }),
        dispatchOutbox: async () => ({ outcome: 'delivered', providerMessageId: 'wamid.test' }),
        processJob: async () => ({ outcome: 'completed' }),
      },
      { enabled: true, batchSize: 10 },
      inbox,
      outbox,
      jobs,
    );

    expect(await worker.tick()).toBe(3);
    expect((await db.pool.query('SELECT status FROM runtime.inbox_events WHERE inbox_event_id=$1', [inboxEventId])).rows[0]?.status).toBe('processed');
    expect((await db.pool.query('SELECT state FROM runtime.outbox_commands WHERE outbox_command_id=$1', [outboxCommandId])).rows[0]?.state).toBe('delivered');
    expect((await db.pool.query('SELECT status FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [scheduledJobId])).rows[0]?.status).toBe('completed');
  });

  it('records append-only audit entries with actor and correlation metadata', async () => {
    const audit = new runtime.AuditRepository();
    const auditId = await audit.record(db.pool, {
      eventType: 'lead.stage_changed',
      actorType: 'worker',
      actorId: 'worker-a',
      aggregateType: 'lead',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      payload: { stage: 'qualified' },
      before: { stage: 'new' },
      after: { stage: 'qualified' },
    });
    const row = await db.pool.query<{ actor_type: string; correlation_id: string; causation_id: string }>(
      'SELECT actor_type, correlation_id, causation_id FROM audit.events WHERE audit_event_id=$1',
      [auditId],
    );
    expect(row.rows[0]).toEqual({ actor_type: 'worker', correlation_id: 'corr-1', causation_id: 'cause-1' });
    await expect(db.pool.query("UPDATE audit.events SET actor_id='tamper' WHERE audit_event_id=$1", [auditId])).rejects.toThrow(
      /audit_events_are_append_only/,
    );
  });
});
