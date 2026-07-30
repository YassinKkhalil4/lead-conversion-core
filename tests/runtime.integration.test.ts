import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    META_APP_SECRET: 'test_meta_app_secret_123456',
    META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token_123456',
    META_APPROVED_TEMPLATE_NAMES: 'lead_welcome',
    N8N_COMPAT_ROUTES_ENABLED: 'true',
  };

  let db: typeof import('../src/db/pool.js');
  let runtime: typeof import('../src/infrastructure/runtime.js');
  let runtimeWorker: typeof import('../src/worker/runtime-worker.js');
  let messageRequests: typeof import('../src/services/message-request-service.js');
  let metaStatus: typeof import('../src/services/meta-status-webhook-service.js');
  let versionedConfig: typeof import('../src/configuration/versioned-config-service.js');
  let configRepository: typeof import('../src/repositories/config-repository.js');
  let conversationRepository: typeof import('../src/repositories/conversation-repository.js');
  let appModule: typeof import('../src/app.js');

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${socketDir}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
    process.env.DATABASE_URL = databaseUrl;
    process.env.EDGE_SHARED_SECRET = env.EDGE_SHARED_SECRET;
    process.env.EDGE_INTERNAL_SECRET = env.EDGE_INTERNAL_SECRET;
    process.env.META_APP_SECRET = env.META_APP_SECRET;
    process.env.META_WEBHOOK_VERIFY_TOKEN = env.META_WEBHOOK_VERIFY_TOKEN;
    process.env.META_APPROVED_TEMPLATE_NAMES = env.META_APPROVED_TEMPLATE_NAMES;
    process.env.N8N_COMPAT_ROUTES_ENABLED = env.N8N_COMPAT_ROUTES_ENABLED;
    db = await import('../src/db/pool.js');
    runtime = await import('../src/infrastructure/runtime.js');
    runtimeWorker = await import('../src/worker/runtime-worker.js');
    messageRequests = await import('../src/services/message-request-service.js');
    metaStatus = await import('../src/services/meta-status-webhook-service.js');
    versionedConfig = await import('../src/configuration/versioned-config-service.js');
    configRepository = await import('../src/repositories/config-repository.js');
    conversationRepository = await import('../src/repositories/conversation-repository.js');
    appModule = await import('../src/app.js');
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
        configuration.active_versions,
        configuration.versions,
        app.message_delivery_events,
        app.messages,
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

  function metaStatusPayload(providerMessageId = 'wamid.status.delivered'): Record<string, unknown> {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-sanitized',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '201000000000',
                  phone_number_id: 'phone-number-id-test',
                },
                statuses: [
                  {
                    id: providerMessageId,
                    status: 'delivered',
                    timestamp: '1785370000',
                    recipient_id: '201000000001',
                    conversation: { id: 'conversation-sanitized' },
                    pricing: { billable: true, pricing_model: 'CBP', category: 'service' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  function signedMetaWebhook(payload: Record<string, unknown>): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify(payload);
    return {
      rawBody,
      signature: metaStatus.metaSignature(Buffer.from(rawBody), env.META_APP_SECRET),
    };
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

  it('creates idempotent outbound message requests and outbox commands transactionally', async () => {
    const service = new messageRequests.MessageRequestService();
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-message-request', 'Message Request Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');

    const first = await service.requestWhatsAppSend({
      clientId,
      requestKey: 'lead-1:welcome',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000001',
      payload: { kind: 'text', text: 'Welcome' },
      conversationWindowExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      actorId: 'test-worker',
    });
    const second = await service.requestWhatsAppSend({
      clientId,
      requestKey: 'lead-1:welcome',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000001',
      payload: { kind: 'text', text: 'Welcome' },
      conversationWindowExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      actorId: 'test-worker',
    });

    expect(second).toEqual(first);
    expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='message.send_requested'")).rows[0]?.count).toBe('1');
    const outboxPayload = await db.pool.query<{ payload_json: { messageId?: string }; idempotency_key: string }>(
      'SELECT payload_json, idempotency_key FROM runtime.outbox_commands WHERE outbox_command_id=$1',
      [first.outboxCommandId],
    );
    expect(outboxPayload.rows[0]?.payload_json.messageId).toBe(first.messageId);
    expect(outboxPayload.rows[0]?.idempotency_key).toBe(first.idempotencyKey);
    await new runtime.RuntimeOutboxRepository().markDelivered(first.outboxCommandId, 'wamid.accepted.from.outbox');
    expect((await db.pool.query('SELECT provider_message_id, state FROM app.messages WHERE message_id=$1', [first.messageId])).rows[0]).toEqual({
      provider_message_id: 'wamid.accepted.from.outbox',
      state: 'accepted',
    });
  });

  it('accepts internal WhatsApp send requests through the authenticated API route', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-message-route', 'Message Route Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/messages/whatsapp/send',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload: {
          clientId,
          requestKey: 'lead-2:welcome',
          phoneNumberId: 'phone-number-id-test',
          toE164: '+201000000002',
          payload: { kind: 'text', text: 'Welcome from route' },
          conversationWindowExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok?: boolean; messageId?: string; outboxCommandId?: string };
      expect(body.ok).toBe(true);
      expect(body.messageId).toBeTruthy();
      expect(body.outboxCommandId).toBeTruthy();
      expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('accepts lead intake idempotently and enqueues first contact without provider calls', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-intake', 'Intake Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    await db.pool.query(
      "INSERT INTO app.projects (client_id, legacy_airtable_id, project_name, active) VALUES ($1, 'recPROJECTINTAKE', 'North Coast Homes', true)",
      [clientId],
    );
    const app = await appModule.buildApp();
    try {
      const payload = {
        clientKey: 'client-intake',
        provider: 'facebook',
        providerExternalId: 'fb-lead-001',
        source: 'facebook_lead_ads',
        contact: {
          name: 'Intake Lead',
          phoneRaw: '01099999991',
          email: 'lead@example.test',
          consentStatus: 'lead_form',
        },
        project: { legacyAirtableId: 'recPROJECTINTAKE' },
        rawPayload: { form_id: 'form-sanitized', campaign_id: 'campaign-sanitized' },
        firstContact: {
          phoneNumberId: 'phone-number-id-test',
          requestKey: 'fb-lead-001:first-contact',
          payload: { kind: 'template', templateName: 'lead_welcome', languageCode: 'en_US', components: [] },
        },
      };
      const first = await app.inject({
        method: 'POST',
        url: '/internal/leads/intake',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload,
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json() as {
        ok: boolean;
        leadId: string;
        contactId: string;
        duplicate: boolean;
        projectionOutboxCommandId: string;
        firstContact: { outboxCommandId: string; messageId: string };
      };
      expect(firstBody.ok).toBe(true);
      expect(firstBody.duplicate).toBe(false);
      expect(firstBody.projectionOutboxCommandId).toBeTruthy();
      expect(firstBody.firstContact.outboxCommandId).toBeTruthy();

      const duplicate = await app.inject({
        method: 'POST',
        url: '/internal/leads/intake',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload,
      });
      expect(duplicate.statusCode).toBe(200);
      const duplicateBody = duplicate.json() as { leadId: string; contactId: string; duplicate: boolean; projectionOutboxCommandId: string; firstContact: { outboxCommandId: string; messageId: string } };
      expect(duplicateBody).toMatchObject({
        leadId: firstBody.leadId,
        contactId: firstBody.contactId,
        duplicate: true,
        projectionOutboxCommandId: firstBody.projectionOutboxCommandId,
      });
      expect(duplicateBody.firstContact.messageId).toBe(firstBody.firstContact.messageId);
      expect(duplicateBody.firstContact.outboxCommandId).toBe(firstBody.firstContact.outboxCommandId);
      expect((await db.pool.query('SELECT count(*) FROM app.contacts')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM app.lead_intake_events')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('2');
      await new runtime.RuntimeOutboxRepository().markPermanentlyFailed(firstBody.projectionOutboxCommandId, 'airtable_projection_credentials_missing');
      expect((await db.pool.query('SELECT count(*) FROM app.leads WHERE lead_id=$1', [firstBody.leadId])).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT state FROM runtime.outbox_commands WHERE command_type='airtable.project_lead_visibility'")).rows[0]?.state).toBe('permanently_failed');
      expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='lead.intake_received'")).rows[0]?.count).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('suppresses lead intake first contact for opted-out contacts', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-intake-optout', 'Intake Opt Out Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    await db.pool.query(
      `INSERT INTO app.contacts (client_id, name, phone_raw, phone_e164, opted_out, opt_out_reason)
       VALUES ($1, 'Opted Out Lead', '01099999992', '+201099999992', true, 'prior_stop')`,
      [clientId],
    );
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/leads/intake',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload: {
          clientId,
          provider: 'website',
          providerExternalId: 'web-lead-002',
          source: 'website_form',
          contact: { name: 'Opted Out Lead', phoneRaw: '01099999992' },
          rawPayload: { form: 'website-sanitized' },
          firstContact: {
            requestKey: 'web-lead-002:first-contact',
            payload: { kind: 'template', templateName: 'lead_welcome', languageCode: 'en_US', components: [] },
          },
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { firstContact: { suppressed: boolean; suppressionReason: string } };
      expect(body.firstContact).toMatchObject({ suppressed: true, suppressionReason: 'contact_opted_out' });
      expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('0');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT command_type FROM runtime.outbox_commands")).rows[0]?.command_type).toBe('airtable.project_lead_visibility');
    } finally {
      await app.close();
    }
  });

  it('receives website lead webhooks through durable inbox before intake processing', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-website-ingress', 'Website Ingress Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    await db.pool.query(
      "INSERT INTO app.projects (client_id, project_name, active) VALUES ($1, 'Website Towers', true)",
      [clientId],
    );
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/leads/website',
        headers: { 'x-edge-secret': env.EDGE_SHARED_SECRET },
        payload: {
          eventId: 'website-lead-001',
          clientKey: 'client-website-ingress',
          name: 'Website Lead',
          phone: '01099999993',
          email: 'website@example.test',
          projectName: 'Website Towers',
          campaign: 'landing_page',
          firstContact: {
            requestKey: 'website-lead-001:first-contact',
            payload: { kind: 'template', templateName: 'lead_welcome', languageCode: 'en_US', components: [] },
          },
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; inboxEventId: string; intake: { leadId: string; firstContact: { outboxCommandId: string } } };
      expect(body.ok).toBe(true);
      expect(body.inboxEventId).toBeTruthy();
      expect(body.intake.firstContact.outboxCommandId).toBeTruthy();
      expect((await db.pool.query("SELECT status FROM runtime.inbox_events WHERE provider='website' AND external_event_id='website-lead-001'")).rows[0]?.status).toBe('processed');
      expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('2');
    } finally {
      await app.close();
    }
  });

  it('receives sanitized Facebook lead payloads without live Graph API calls', async () => {
    await db.pool.query("INSERT INTO app.clients (client_key, company_name) VALUES ('client-facebook-ingress', 'Facebook Ingress Client')");
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/leads/facebook',
        headers: { 'x-edge-secret': env.EDGE_SHARED_SECRET },
        payload: {
          clientKey: 'client-facebook-ingress',
          leadgen_id: 'fb-lead-graphless-001',
          form_id: 'form-sanitized',
          page_id: 'page-sanitized',
          campaign_id: 'campaign-sanitized',
          field_data: [
            { name: 'full_name', values: ['Facebook Lead'] },
            { name: 'phone_number', values: ['01099999994'] },
            { name: 'email', values: ['facebook@example.test'] },
            { name: 'project_name', values: ['Unknown Project Interest'] },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; intake: { firstContact: null; duplicate: boolean } };
      expect(body.ok).toBe(true);
      expect(body.intake.firstContact).toBeNull();
      expect(body.intake.duplicate).toBe(false);
      expect((await db.pool.query("SELECT status FROM runtime.inbox_events WHERE provider='facebook' AND external_event_id='fb-lead-graphless-001'")).rows[0]?.status).toBe('processed');
      expect((await db.pool.query("SELECT provider, provider_external_id FROM app.leads WHERE provider='facebook'")).rows[0]).toEqual({
        provider: 'facebook',
        provider_external_id: 'fb-lead-graphless-001',
      });
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('durably records and ignores invalid website lead webhook payloads', async () => {
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/leads/website',
        headers: { 'x-edge-secret': env.EDGE_SHARED_SECRET },
        payload: {
          eventId: 'website-lead-invalid-001',
          clientKey: 'missing-client',
          name: 'Invalid Website Lead',
        },
      });
      expect(response.statusCode).toBe(400);
      expect((await db.pool.query("SELECT status, ignored_reason FROM runtime.inbox_events WHERE provider='website' AND external_event_id='website-lead-invalid-001'")).rows[0]).toMatchObject({
        status: 'ignored',
      });
      expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('0');
    } finally {
      await app.close();
    }
  });

  it('verifies Meta webhook challenges and rejects invalid status signatures without durable receipt', async () => {
    const app = await appModule.buildApp();
    try {
      const challenge = await app.inject({
        method: 'GET',
        url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=test_meta_verify_token_123456&hub.challenge=challenge-ok',
      });
      expect(challenge.statusCode).toBe(200);
      expect(challenge.body).toBe('challenge-ok');

      const invalid = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=invalid',
        },
        payload: JSON.stringify(metaStatusPayload()),
      });
      expect(invalid.statusCode).toBe(401);
      expect((await db.pool.query('SELECT count(*) FROM runtime.inbox_events')).rows[0]?.count).toBe('0');
    } finally {
      await app.close();
    }
  });

  it('durably receives duplicate Meta status webhooks and processes one delivery event idempotently', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-status-webhook', 'Status Webhook Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    await db.pool.query(
      `INSERT INTO app.messages
        (client_id, direction, channel, to_address, message_text, message_type, provider_message_id, state)
       VALUES ($1, 'outbound', 'whatsapp', '+201000000001', 'Delivered status target', 'text', 'wamid.status.delivered', 'accepted')`,
      [clientId],
    );

    const app = await appModule.buildApp();
    try {
      const signed = signedMetaWebhook(metaStatusPayload());
      const first = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ ok: true, received: 1, duplicates: 0 });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ ok: true, received: 1, duplicates: 1 });
      expect((await db.pool.query('SELECT count(*) FROM runtime.webhook_receipts WHERE signature_valid=true AND raw_body IS NOT NULL')).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM runtime.inbox_events WHERE event_type='whatsapp.message_status'")).rows[0]?.count).toBe('1');

      const processor = new metaStatus.MetaStatusProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);
      expect((await db.pool.query("SELECT state FROM app.messages WHERE provider_message_id='wamid.status.delivered'")).rows[0]?.state).toBe('delivered');
      expect((await db.pool.query('SELECT count(*) FROM app.message_delivery_events')).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='message.delivery_status_received'")).rows[0]?.count).toBe('1');
      expect(await worker.tick()).toBe(0);
      expect((await db.pool.query('SELECT count(*) FROM app.message_delivery_events')).rows[0]?.count).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('accepts n8n-compatible outbound send requests without live provider calls', async () => {
    await db.pool.query(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ('client-n8n-send', 'recN8NCLIENT001', 'n8n Send Client')`,
    );
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/compat/n8n/messages/whatsapp/send',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload: {
          clientRecordId: 'recN8NCLIENT001',
          sourceEventId: 'n8n-send-001',
          phoneNumberId: 'phone-number-id-test',
          phoneNormalized: '+201000000004',
          text: 'n8n compatibility send',
          conversationWindowExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok?: boolean; messageId?: string; outboxCommandId?: string };
      expect(body.ok).toBe(true);
      expect(body.messageId).toBeTruthy();
      expect(body.outboxCommandId).toBeTruthy();
      expect((await db.pool.query('SELECT state, provider_message_id FROM app.messages WHERE message_id=$1', [body.messageId])).rows[0]).toEqual({
        state: 'queued',
        provider_message_id: '',
      });
      expect((await db.pool.query('SELECT state, provider_message_id FROM runtime.outbox_commands WHERE outbox_command_id=$1', [body.outboxCommandId])).rows[0]).toEqual({
        state: 'pending',
        provider_message_id: '',
      });
    } finally {
      await app.close();
    }
  });

  it('receives n8n-compatible status acknowledgements through durable inbox', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ('client-n8n-status', 'recN8NCLIENT002', 'n8n Status Client')
       RETURNING client_id`,
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    await db.pool.query(
      `INSERT INTO app.messages
        (client_id, direction, channel, to_address, message_text, message_type, provider_message_id, state)
       VALUES ($1, 'outbound', 'whatsapp', '+201000000005', 'n8n status target', 'text', 'wamid.n8n.delivered', 'accepted')`,
      [clientId],
    );

    const app = await appModule.buildApp();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/compat/n8n/messages/whatsapp/status',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload: {
          clientRecordId: 'recN8NCLIENT002',
          providerMessageId: 'wamid.n8n.delivered',
          status: 'delivered',
          providerTimestamp: '2026-07-30T01:00:00.000Z',
          recipientId: '201000000005',
          sourceEventId: 'n8n-status-001',
        },
      });
      const duplicate = await app.inject({
        method: 'POST',
        url: '/compat/n8n/messages/whatsapp/status',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload: {
          clientRecordId: 'recN8NCLIENT002',
          providerMessageId: 'wamid.n8n.delivered',
          status: 'delivered',
          providerTimestamp: '2026-07-30T01:00:00.000Z',
          recipientId: '201000000005',
          sourceEventId: 'n8n-status-001',
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ ok: true, received: 1, duplicate: false });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.json()).toMatchObject({ ok: true, received: 1, duplicate: true });
      expect((await db.pool.query("SELECT count(*) FROM runtime.inbox_events WHERE provider='n8n' AND event_type='whatsapp.message_status'")).rows[0]?.count).toBe('1');

      const processor = new metaStatus.MetaStatusProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);
      expect((await db.pool.query("SELECT state FROM app.messages WHERE provider_message_id='wamid.n8n.delivered'")).rows[0]?.state).toBe('delivered');
      expect((await db.pool.query('SELECT count(*) FROM app.message_delivery_events')).rows[0]?.count).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('enforces WhatsApp session-window and approved-template policy before enqueueing sends', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('client-message-policy', 'Message Policy Client') RETURNING client_id",
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    const service = new messageRequests.MessageRequestService(
      new runtime.RuntimeOutboxRepository(),
      new runtime.AuditRepository(),
      {
        approvedTemplateNames: ['lead_permission_v1'],
        now: () => new Date('2026-07-30T00:00:00.000Z'),
      },
    );

    await expect(service.requestWhatsAppSend({
      clientId,
      requestKey: 'lead-3:expired-session',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000003',
      payload: { kind: 'text', text: 'This should not enqueue' },
      conversationWindowExpiresAt: '2026-07-29T23:59:00.000Z',
    })).rejects.toThrow(/conversation_window_expired/);
    await expect(service.requestWhatsAppSend({
      clientId,
      requestKey: 'lead-3:unapproved-template',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000003',
      payload: {
        kind: 'template',
        templateName: 'not_approved',
        languageCode: 'en_US',
        components: [],
      },
    })).rejects.toThrow(/whatsapp_template_not_approved/);

    await service.requestWhatsAppSend({
      clientId,
      requestKey: 'lead-3:approved-template',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000003',
      payload: {
        kind: 'template',
        templateName: 'lead_permission_v1',
        languageCode: 'en_US',
        components: [],
      },
    });
    expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
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

  it('publishes immutable versioned configuration and maintains the legacy active snapshot', async () => {
    const service = new versionedConfig.VersionedConfigService();
    const sourcePath = join(process.cwd(), 'config/seed-real-estate.json');
    const compiled = await service.loadAndCompile(sourcePath, null);
    expect(service.validate(compiled)).toMatchObject({
      ok: true,
      version: compiled.version,
      questions: 9,
      messages: 7,
    });
    expect(await service.diff(sourcePath, null)).toMatchObject({
      fromVersion: '',
      toVersion: compiled.version,
      questionCountDelta: 9,
      messageCountDelta: 7,
    });

    const published = await service.publish({
      sourcePath,
      clientRecordId: null,
      publishedBy: 'test-operator',
    });
    const republished = await service.publish({
      sourcePath,
      clientRecordId: null,
      publishedBy: 'test-operator',
    });

    expect(republished.configurationVersionId).toBe(published.configurationVersionId);
    expect((await db.pool.query('SELECT count(*) FROM configuration.versions')).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT configuration_version_id FROM configuration.active_versions WHERE scope_key='default'")).rows[0]?.configuration_version_id).toBe(
      published.configurationVersionId,
    );
    expect((await db.pool.query('SELECT active FROM edge_config_snapshots WHERE config_version=$1', [published.versionKey])).rows[0]?.active).toBe(true);
    await expect(
      db.pool.query("UPDATE configuration.versions SET config_json='{}'::jsonb WHERE configuration_version_id=$1", [published.configurationVersionId]),
    ).rejects.toThrow(/published_configuration_versions_are_immutable/);
  });

  it('activates and rolls back published configuration versions for runtime reads', async () => {
    const service = new versionedConfig.VersionedConfigService();
    const repository = new configRepository.ConfigRepository();
    const sourcePath = join(process.cwd(), 'config/seed-real-estate.json');
    const original = await service.publish({
      sourcePath,
      clientRecordId: null,
      publishedBy: 'test-operator',
    });

    const variantPath = join(root, 'seed-real-estate-variant.json');
    const variant = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      messages: Array<{ fields: Record<string, unknown> }>;
    };
    const fallback = variant.messages.find((message) => message.fields['Message Key'] === 'fallback');
    if (!fallback) throw new Error('fallback_message_not_found');
    fallback.fields.English = 'Variant fallback message';
    writeFileSync(variantPath, JSON.stringify(variant, null, 2));
    const changed = await service.publish({
      sourcePath: variantPath,
      clientRecordId: null,
      publishedBy: 'test-operator',
    });
    expect(changed.versionKey).not.toBe(original.versionKey);
    expect((await service.getActiveMetadata('default'))?.versionKey).toBe(changed.versionKey);
    expect((await repository.getActive('')).version).toBe(changed.versionKey);

    const rollbackOutput = execFileSync('npm', ['run', '--silent', 'config', '--', 'rollback', `--version=${original.versionKey}`, '--actor=test-operator'], {
      env,
      encoding: 'utf8',
    });
    const rolledBack = JSON.parse(rollbackOutput) as { versionKey: string };
    expect(rolledBack.versionKey).toBe(original.versionKey);
    expect((await repository.getActive('')).version).toBe(original.versionKey);
    expect((await db.pool.query('SELECT count(*) FROM configuration.versions')).rows[0]?.count).toBe('2');
  });

  it('pins conversations to immutable configuration version ids while preserving legacy config_version', async () => {
    await db.pool.query('TRUNCATE edge_conversations, edge_config_snapshots RESTART IDENTITY CASCADE');
    const service = new versionedConfig.VersionedConfigService();
    const repository = new configRepository.ConfigRepository();
    const conversations = new conversationRepository.ConversationRepository();
    const sourcePath = join(process.cwd(), 'config/seed-real-estate.json');
    const original = await service.publish({
      sourcePath,
      clientRecordId: null,
      publishedBy: 'test-operator',
    });
    const active = await repository.getActiveSnapshot('rec_client_pin');
    expect(active).toMatchObject({
      versionKey: original.versionKey,
      configurationVersionId: original.configurationVersionId,
      source: 'versioned',
    });

    const client = await db.pool.connect();
    try {
      await conversations.getOrCreate(client, {
        eventId: 'evt-config-pin-1',
        metaMessageId: 'wamid.config.pin.1',
        clientRecordId: 'rec_client_pin',
        clientId: 'client-pin',
        phoneNormalized: '+201099999991',
        leadRecordId: 'rec_lead_pin',
        leadId: 'lead-pin',
        leadName: 'Pinned Lead',
      }, active, { conversationEngine: 'legacy', stateAuthority: 'legacy' });
    } finally {
      client.release();
    }

    const inserted = await db.pool.query<{ config_version: string; configuration_version_id: string | null }>(
      'SELECT config_version, configuration_version_id FROM edge_conversations WHERE client_record_id=$1 AND phone_normalized=$2',
      ['rec_client_pin', '+201099999991'],
    );
    expect(inserted.rows[0]).toEqual({
      config_version: original.versionKey,
      configuration_version_id: original.configurationVersionId,
    });

    const variantPath = join(root, 'seed-real-estate-pin-variant.json');
    const variant = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      messages: Array<{ fields: Record<string, unknown> }>;
    };
    const fallback = variant.messages.find((message) => message.fields['Message Key'] === 'fallback');
    if (!fallback) throw new Error('fallback_message_not_found');
    fallback.fields.English = 'Pinned variant fallback message';
    writeFileSync(variantPath, JSON.stringify(variant, null, 2));
    const changed = await service.publish({
      sourcePath: variantPath,
      clientRecordId: null,
      publishedBy: 'test-operator',
    });
    expect(changed.versionKey).not.toBe(original.versionKey);

    const changedActive = await repository.getActiveSnapshot('rec_client_pin');
    const secondClient = await db.pool.connect();
    try {
      await conversations.getOrCreate(secondClient, {
        eventId: 'evt-config-pin-2',
        metaMessageId: 'wamid.config.pin.2',
        clientRecordId: 'rec_client_pin',
        clientId: 'client-pin',
        phoneNormalized: '+201099999991',
        leadRecordId: 'rec_lead_pin',
        leadName: 'Pinned Lead After Publish',
      }, changedActive, { conversationEngine: 'legacy', stateAuthority: 'legacy' });
    } finally {
      secondClient.release();
    }

    const unchanged = await db.pool.query<{ config_version: string; configuration_version_id: string | null }>(
      'SELECT config_version, configuration_version_id FROM edge_conversations WHERE client_record_id=$1 AND phone_normalized=$2',
      ['rec_client_pin', '+201099999991'],
    );
    expect(unchanged.rows[0]).toEqual({
      config_version: original.versionKey,
      configuration_version_id: original.configurationVersionId,
    });

    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/conversations/bootstrap',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload: {
          clientRecordId: 'rec_client_pin',
          clientId: 'client-pin',
          phoneNormalized: '+201099999991',
          leadRecordId: 'rec_lead_pin',
          leadName: 'Pinned Lead Migrated',
          migrateConfig: true,
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { conversation?: { config_version: string; configuration_version_id: string | null } };
      expect(body.conversation).toMatchObject({
        config_version: changed.versionKey,
        configuration_version_id: changed.configurationVersionId,
      });
    } finally {
      await app.close();
    }
  });
});
