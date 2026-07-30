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
  let metaInbox: typeof import('../src/services/meta-inbox-processor.js');
  let leadScoring: typeof import('../src/services/lead-scoring-service.js');
  let leadRouting: typeof import('../src/services/lead-routing-service.js');
  let followupScheduler: typeof import('../src/services/followup-scheduler-service.js');
  let followupJob: typeof import('../src/services/followup-job-processor.js');
  let slaService: typeof import('../src/services/sla-service.js');
  let reportingService: typeof import('../src/services/reporting-service.js');
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
    metaInbox = await import('../src/services/meta-inbox-processor.js');
    leadScoring = await import('../src/services/lead-scoring-service.js');
    leadRouting = await import('../src/services/lead-routing-service.js');
    followupScheduler = await import('../src/services/followup-scheduler-service.js');
    followupJob = await import('../src/services/followup-job-processor.js');
    slaService = await import('../src/services/sla-service.js');
    reportingService = await import('../src/services/reporting-service.js');
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

  function metaInboundPayload(input: {
    providerMessageId: string;
    from: string;
    phoneNumberId: string;
    text: string;
  }): Record<string, unknown> {
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
                  phone_number_id: input.phoneNumberId,
                },
                contacts: [
                  {
                    wa_id: input.from.replace(/^\+/, ''),
                    profile: { name: 'MP08 Lead' },
                  },
                ],
                messages: [
                  {
                    id: input.providerMessageId,
                    from: input.from.replace(/^\+/, ''),
                    timestamp: '1785370000',
                    type: 'text',
                    text: { body: input.text },
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

  async function seedMp08Conversation(input: {
    suffix: string;
    phone: string;
    phoneNumberId: string;
    humanTakeover?: boolean;
    preferredLanguage?: 'English' | 'Arabic';
    currentStage?: string;
    currentQuestionKey?: string;
    answers?: Record<string, string>;
  }): Promise<{ clientId: string; contactId: string; leadId: string; projectId: string; versionKey: string; configurationVersionId: string }> {
    await db.pool.query('TRUNCATE edge_active_turns, edge_message_events, edge_conversations, edge_client_channels, edge_config_snapshots RESTART IDENTITY CASCADE');
    const service = new versionedConfig.VersionedConfigService();
    const clientRecordId = `recMP08${input.suffix}`;
    const published = await service.publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId,
      publishedBy: 'test-operator',
    });
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ($1, $2, $3)
       RETURNING client_id`,
      [`client-mp08-${input.suffix.toLocaleLowerCase()}`, clientRecordId, `MP08 ${input.suffix} Client`],
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, legacy_airtable_id, name, phone_raw, phone_e164, consent_status)
       VALUES ($1, $2, 'MP08 Lead', $3, $3, 'opted_in')
       RETURNING contact_id`,
      [clientId, `recMP08${input.suffix}CONTACT`, input.phone],
    );
    const contactId = contact.rows[0]?.contact_id;
    if (!contactId) throw new Error('contact_not_created');
    const project = await db.pool.query<{ project_id: string }>(
      `INSERT INTO app.projects (client_id, legacy_airtable_id, project_name)
       VALUES ($1, $2, $3)
       RETURNING project_id`,
      [clientId, `recMP08${input.suffix}PROJECT`, `MP08 ${input.suffix} Project`],
    );
    const projectId = project.rows[0]?.project_id;
    if (!projectId) throw new Error('project_not_created');
    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, project_id, legacy_airtable_id, provider, provider_external_id, source, source_payload_hash, current_stage)
       VALUES ($1, $2, $3, $4, 'airtable', $4, 'airtable_import', $5, 'asking_location')
       RETURNING lead_id`,
      [clientId, contactId, projectId, `recMP08${input.suffix}LEAD`, `fixture-hash-${input.suffix}`],
    );
    const leadId = lead.rows[0]?.lead_id;
    if (!leadId) throw new Error('lead_not_created');
    await db.pool.query(
      `INSERT INTO edge_client_channels
        (phone_number_id, client_record_id, client_id, company_name, active, config_version, direct_send_enabled, graph_phone_number_id)
       VALUES ($1, $2, $3, $4, true, $5, true, $1)`,
      [input.phoneNumberId, clientRecordId, clientId, `MP08 ${input.suffix} Client`, published.versionKey],
    );
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, project_name, project_record_id, preferred_language, current_stage,
         current_question_key, answers_json, status, human_takeover, conversation_engine,
         state_authority, config_version, configuration_version_id)
       VALUES (
         $1, $2, $3, $4, $5, 'MP08 Lead',
         $6, $7, $8, $9, $10,
         $11, $12::jsonb, 'in_qualification', $13, 'edge',
         'edge', $14, $15
       )`,
      [
        clientRecordId,
        clientId,
        input.phone,
        `recMP08${input.suffix}LEAD`,
        leadId,
        `MP08 ${input.suffix} Client`,
        `MP08 ${input.suffix} Project`,
        `recMP08${input.suffix}PROJECT`,
        input.preferredLanguage ?? 'English',
        input.currentStage ?? 'asking_location',
        input.currentQuestionKey ?? 'q_location',
        JSON.stringify(input.answers ?? {}),
        input.humanTakeover ?? false,
        published.versionKey,
        published.configurationVersionId,
      ],
    );
    return {
      clientId,
      contactId,
      leadId,
      projectId,
      versionKey: published.versionKey,
      configurationVersionId: published.configurationVersionId,
    };
  }

  async function receiveAndProcessMetaInbound(input: {
    providerMessageId: string;
    from: string;
    phoneNumberId: string;
    text: string;
    expectedDuplicates?: number;
  }): Promise<void> {
    const app = await appModule.buildApp();
    try {
      const payload = metaInboundPayload({
        providerMessageId: input.providerMessageId,
        from: input.from,
        phoneNumberId: input.phoneNumberId,
        text: input.text,
      });
      const signed = signedMetaWebhook(payload);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, received: 1, duplicates: input.expectedDuplicates ?? 0 });
    } finally {
      await app.close();
    }

    const processor = new metaInbox.MetaInboxProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processInbox: (event) => processor.process(event) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(input.expectedDuplicates ? 0 : 1);
  }

  async function seedAssignedLead(input: {
    suffix: string;
    phone: string;
    salespersonPhone: string;
  }): Promise<{
    clientId: string;
    leadId: string;
    salespersonId: string;
    assignmentId: string;
  }> {
    const seeded = await seedMp08Conversation({
      suffix: input.suffix,
      phone: input.phone,
      phoneNumberId: `phone-number-id-${input.suffix.toLocaleLowerCase()}`,
    });
    const salesperson = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople
        (client_id, legacy_airtable_id, name, phone_e164, active, priority_rank)
       VALUES ($1, $2, $3, $4, true, 10)
       RETURNING salesperson_id`,
      [seeded.clientId, `rec${input.suffix}SP`, `${input.suffix} Sales`, input.salespersonPhone],
    );
    const salespersonId = salesperson.rows[0]?.salesperson_id;
    if (!salespersonId) throw new Error('salesperson_not_created');
    const assignment = await db.pool.query<{ lead_assignment_id: string }>(
      `INSERT INTO app.lead_assignments
        (lead_id, salesperson_id, routing_version, idempotency_key)
       VALUES ($1, $2, 'real_estate_v1', $3)
       RETURNING lead_assignment_id`,
      [seeded.leadId, salespersonId, `assignment:${input.suffix}`],
    );
    const assignmentId = assignment.rows[0]?.lead_assignment_id;
    if (!assignmentId) throw new Error('assignment_not_created');
    return {
      clientId: seeded.clientId,
      leadId: seeded.leadId,
      salespersonId,
      assignmentId,
    };
  }

  async function receiveSalespersonCommand(input: {
    clientId: string;
    leadId?: string;
    assignmentId?: string;
    fromE164: string;
    messageText: string;
    commandIntent?: string;
    sourceEventId: string;
    expectedDuplicate?: boolean;
  }): Promise<void> {
    const app = await appModule.buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/compat/n8n/salesperson/commands',
        headers: {
          'x-internal-secret': env.EDGE_INTERNAL_SECRET,
        },
        payload: {
          clientId: input.clientId,
          leadId: input.leadId,
          assignmentId: input.assignmentId,
          fromE164: input.fromE164,
          messageText: input.messageText,
          commandIntent: input.commandIntent || '',
          sourceEventId: input.sourceEventId,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, received: 1, duplicate: input.expectedDuplicate ?? false });
    } finally {
      await app.close();
    }
  }

  function todayInCairo(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
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

  it('processes durable Meta inbound messages through Edge conversation state and queues replies atomically', async () => {
    await db.pool.query('TRUNCATE edge_active_turns, edge_message_events, edge_conversations, edge_client_channels, edge_config_snapshots RESTART IDENTITY CASCADE');
    const service = new versionedConfig.VersionedConfigService();
    const published = await service.publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId: 'recMP08CLIENT',
      publishedBy: 'test-operator',
    });
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ('client-mp08-inbound', 'recMP08CLIENT', 'MP08 Client')
       RETURNING client_id`,
    );
    const clientId = client.rows[0]?.client_id;
    if (!clientId) throw new Error('client_not_created');
    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, legacy_airtable_id, name, phone_raw, phone_e164, consent_status)
       VALUES ($1, 'recMP08CONTACT', 'MP08 Lead', '201099999995', '+201099999995', 'opted_in')
       RETURNING contact_id`,
      [clientId],
    );
    const contactId = contact.rows[0]?.contact_id;
    if (!contactId) throw new Error('contact_not_created');
    const project = await db.pool.query<{ project_id: string }>(
      `INSERT INTO app.projects (client_id, legacy_airtable_id, project_name)
       VALUES ($1, 'recMP08PROJECT', 'MP08 Project')
       RETURNING project_id`,
      [clientId],
    );
    const projectId = project.rows[0]?.project_id;
    if (!projectId) throw new Error('project_not_created');
    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, project_id, legacy_airtable_id, provider, provider_external_id, source, source_payload_hash, current_stage)
       VALUES ($1, $2, $3, 'recMP08LEAD', 'airtable', 'recMP08LEAD', 'airtable_import', 'fixture-hash', 'asking_location')
       RETURNING lead_id`,
      [clientId, contactId, projectId],
    );
    const leadId = lead.rows[0]?.lead_id;
    if (!leadId) throw new Error('lead_not_created');
    await db.pool.query(
      `INSERT INTO edge_client_channels
        (phone_number_id, client_record_id, client_id, company_name, active, config_version, direct_send_enabled, graph_phone_number_id)
       VALUES ('phone-number-id-mp08', 'recMP08CLIENT', $1, 'MP08 Client', true, $2, true, 'phone-number-id-mp08')`,
      [clientId, published.versionKey],
    );
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, project_name, project_record_id, preferred_language, current_stage,
         current_question_key, answers_json, status, conversation_engine, state_authority,
         config_version, configuration_version_id)
       VALUES (
         'recMP08CLIENT', $1, '+201099999995', 'recMP08LEAD', $2, 'MP08 Lead',
         'MP08 Client', 'MP08 Project', 'recMP08PROJECT', 'English', 'asking_location',
         'q_location', '{}'::jsonb, 'in_qualification', 'edge', 'edge', $3, $4
       )`,
      [clientId, leadId, published.versionKey, published.configurationVersionId],
    );

    const app = await appModule.buildApp();
    try {
      const payload = metaInboundPayload({
        providerMessageId: 'wamid.mp08.inbound.1',
        from: '+201099999995',
        phoneNumberId: 'phone-number-id-mp08',
        text: 'New Cairo',
      });
      const signed = signedMetaWebhook(payload);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, received: 1, duplicates: 0 });
      expect((await db.pool.query("SELECT count(*) FROM runtime.inbox_events WHERE event_type='whatsapp.message_received'")).rows[0]?.count).toBe('1');

      const processor = new metaInbox.MetaInboxProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);
      expect(await worker.tick()).toBe(0);

      const conversation = await db.pool.query<{ current_stage: string; current_question_key: string; q_location: string }>(
        `SELECT current_stage, current_question_key, answers_json->>'q_location' AS q_location
         FROM edge_conversations
         WHERE client_record_id='recMP08CLIENT' AND phone_normalized='+201099999995'`,
      );
      expect(conversation.rows[0]).toEqual({
        current_stage: 'asking_unit_type',
        current_question_key: 'q_unit_type',
        q_location: 'New Cairo',
      });
      expect((await db.pool.query("SELECT status FROM runtime.inbox_events WHERE event_type='whatsapp.message_received'")).rows[0]?.status).toBe('processed');
      expect((await db.pool.query("SELECT normalized_value FROM app.qualification_answers WHERE question_key='q_location'")).rows[0]?.normalized_value).toBe('New Cairo');
      expect((await db.pool.query("SELECT count(*) FROM app.conversations WHERE lead_id=$1 AND current_stage='asking_unit_type'", [leadId])).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM app.messages WHERE direction='inbound' AND provider_message_id='wamid.mp08.inbound.1'")).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM app.messages WHERE direction=$1 AND state=$2', ['outbound', 'queued'])).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message' AND state='pending'")).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT status FROM edge_active_turns WHERE meta_message_id='wamid.mp08.inbound.1'")).rows[0]?.status).toBe('queued');
      expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='conversation.inbound_processed'")).rows[0]?.count).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('records explicit opt-outs from durable inbound messages without enqueueing another WhatsApp send', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'OPTOUT',
      phone: '+201099999997',
      phoneNumberId: 'phone-number-id-mp08-optout',
    });
    const app = await appModule.buildApp();
    try {
      const payload = metaInboundPayload({
        providerMessageId: 'wamid.mp08.optout.inbound.1',
        from: '+201099999997',
        phoneNumberId: 'phone-number-id-mp08-optout',
        text: 'STOP',
      });
      const signed = signedMetaWebhook(payload);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      expect(response.statusCode).toBe(200);

      const processor = new metaInbox.MetaInboxProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);

      expect((await db.pool.query(
        `SELECT status, current_stage, current_question_key, stop_follow_up
         FROM edge_conversations
         WHERE lead_id=$1`,
        [seeded.leadId],
      )).rows[0]).toEqual({
        status: 'not_interested',
        current_stage: 'stopped',
        current_question_key: '',
        stop_follow_up: true,
      });
      expect((await db.pool.query(
        'SELECT status, current_stage, stop_follow_up, stop_reason FROM app.leads WHERE lead_id=$1',
        [seeded.leadId],
      )).rows[0]).toEqual({
        status: 'not_interested',
        current_stage: 'stopped',
        stop_follow_up: true,
        stop_reason: 'lead_opted_out',
      });
      expect((await db.pool.query('SELECT opted_out, opt_out_reason FROM app.contacts WHERE contact_id=$1', [seeded.contactId])).rows[0]).toEqual({
        opted_out: true,
        opt_out_reason: 'lead_opted_out',
      });
      expect((await db.pool.query(
        `SELECT status, current_stage, stop_follow_up, source
         FROM edge_lead_controls
         WHERE client_record_id='recMP08OPTOUT' AND phone_normalized='+201099999997'`,
      )).rows[0]).toEqual({
        status: 'not_interested',
        current_stage: 'stopped',
        stop_follow_up: true,
        source: 'edge_inbound_message',
      });
      expect((await db.pool.query("SELECT count(*) FROM app.conversations WHERE lead_id=$1 AND current_stage='stopped'", [seeded.leadId])).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM app.messages WHERE direction='inbound' AND provider_message_id='wamid.mp08.optout.inbound.1'")).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
      expect((await db.pool.query("SELECT status FROM edge_active_turns WHERE meta_message_id='wamid.mp08.optout.inbound.1'")).rows[0]?.status).toBe('suppressed');
      expect((await db.pool.query("SELECT payload_json->>'reason' AS reason FROM audit.events WHERE event_type='conversation.reply_suppressed'")).rows[0]?.reason).toBe('lead_opted_out');
    } finally {
      await app.close();
    }
  });

  it('suppresses durable inbound replies while human takeover is active and records control state', async () => {
    await seedMp08Conversation({
      suffix: 'TAKEOVER',
      phone: '+201099999998',
      phoneNumberId: 'phone-number-id-mp08-takeover',
      humanTakeover: true,
    });
    const app = await appModule.buildApp();
    try {
      const payload = metaInboundPayload({
        providerMessageId: 'wamid.mp08.takeover.inbound.1',
        from: '+201099999998',
        phoneNumberId: 'phone-number-id-mp08-takeover',
        text: 'New Cairo',
      });
      const signed = signedMetaWebhook(payload);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      expect(response.statusCode).toBe(200);

      const processor = new metaInbox.MetaInboxProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);

      expect((await db.pool.query(
        `SELECT current_stage, current_question_key, human_takeover, answers_json
         FROM edge_conversations
         WHERE client_record_id='recMP08TAKEOVER' AND phone_normalized='+201099999998'`,
      )).rows[0]).toEqual({
        current_stage: 'asking_location',
        current_question_key: 'q_location',
        human_takeover: true,
        answers_json: {},
      });
      expect((await db.pool.query(
        `SELECT current_stage, human_takeover, stop_follow_up, source
         FROM edge_lead_controls
         WHERE client_record_id='recMP08TAKEOVER' AND phone_normalized='+201099999998'`,
      )).rows[0]).toEqual({
        current_stage: 'asking_location',
        human_takeover: true,
        stop_follow_up: false,
        source: 'edge_inbound_message',
      });
      expect((await db.pool.query("SELECT count(*) FROM app.conversations WHERE client_id IS NOT NULL AND current_stage='asking_location' AND human_takeover=true")).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM app.messages WHERE direction='inbound' AND provider_message_id='wamid.mp08.takeover.inbound.1'")).rows[0]?.count).toBe('1');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
      expect((await db.pool.query("SELECT status FROM edge_active_turns WHERE meta_message_id='wamid.mp08.takeover.inbound.1'")).rows[0]?.status).toBe('suppressed');
      expect((await db.pool.query("SELECT payload_json->>'reason' AS reason FROM audit.events WHERE event_type='conversation.reply_suppressed'")).rows[0]?.reason).toBe('human_takeover');
    } finally {
      await app.close();
    }
  });

  it('completes English qualification and does not duplicate handoff effects on replay', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'COMPLETE',
      phone: '+201099999989',
      phoneNumberId: 'phone-number-id-mp08-complete',
      currentStage: 'asking_site_visit',
      currentQuestionKey: 'q_site_visit',
      answers: {
        q_location: 'New Cairo',
        q_unit_type: 'Apartment',
        q_budget_min: '3000000',
        q_budget_max: '5000000',
        q_payment_plan: 'Installments',
        q_down_payment: '500000',
        q_timeline: '3 months',
        q_purpose: 'Primary Residence',
      },
    });

    await receiveAndProcessMetaInbound({
      providerMessageId: 'wamid.mp08.complete.inbound.1',
      from: '+201099999989',
      phoneNumberId: 'phone-number-id-mp08-complete',
      text: 'Yes, please',
    });

    expect((await db.pool.query(
      `SELECT status, current_stage, current_question_key, answers_json->>'q_site_visit' AS site_visit
       FROM edge_conversations
       WHERE lead_id=$1`,
      [seeded.leadId],
    )).rows[0]).toEqual({
      status: 'qualified',
      current_stage: 'qualified',
      current_question_key: '',
      site_visit: 'Yes',
    });
    expect((await db.pool.query('SELECT status, current_stage FROM app.leads WHERE lead_id=$1', [seeded.leadId])).rows[0]).toEqual({
      status: 'qualified',
      current_stage: 'qualified',
    });
    expect((await db.pool.query(
      'SELECT lead_score, temperature FROM app.leads WHERE lead_id=$1',
      [seeded.leadId],
    )).rows[0]).toEqual({
      lead_score: 99,
      temperature: 'hot',
    });
    expect((await db.pool.query(
      `SELECT scoring_version, score, temperature, factors_json->'missingAnswers' AS missing
       FROM app.score_runs
       WHERE lead_id=$1`,
      [seeded.leadId],
    )).rows[0]).toEqual({
      scoring_version: 'real_estate_v1',
      score: 99,
      temperature: 'hot',
      missing: [],
    });
    expect((await db.pool.query(
      "SELECT count(*) FROM audit.events WHERE event_type='lead.scored' AND aggregate_id=$1",
      [seeded.leadId],
    )).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT s.status, s.configuration_version_id, a.normalized_value
       FROM app.qualification_sessions s
       JOIN app.qualification_answers a USING (qualification_session_id)
       WHERE s.lead_id=$1 AND a.question_key='q_site_visit'`,
      [seeded.leadId],
    )).rows[0]).toEqual({
      status: 'completed',
      configuration_version_id: seeded.configurationVersionId,
      normalized_value: 'Yes',
    });
    const projectedConversation = await db.pool.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM app.conversations WHERE lead_id=$1 AND status=$2',
      [seeded.leadId, 'qualified'],
    );
    const appConversationId = projectedConversation.rows[0]?.conversation_id;
    expect(appConversationId).toBeTruthy();
    expect((await db.pool.query('SELECT conversation_id FROM app.qualification_sessions WHERE lead_id=$1', [seeded.leadId])).rows[0]?.conversation_id).toBe(appConversationId);
    expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('2');
    expect((await db.pool.query('SELECT count(*) FROM app.messages WHERE conversation_id=$1', [appConversationId])).rows[0]?.count).toBe('2');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');

    await receiveAndProcessMetaInbound({
      providerMessageId: 'wamid.mp08.complete.inbound.1',
      from: '+201099999989',
      phoneNumberId: 'phone-number-id-mp08-complete',
      text: 'Yes, please',
      expectedDuplicates: 1,
    });
    expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('2');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='conversation.inbound_processed'")).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM app.score_runs WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='lead.scored' AND aggregate_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('scores incomplete qualification data without inventing missing answers and reruns idempotently', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'SCOREMISS',
      phone: '+201099999987',
      phoneNumberId: 'phone-number-id-mp09-score-missing',
    });
    const session = await db.pool.query<{ qualification_session_id: string }>(
      `INSERT INTO app.qualification_sessions
        (lead_id, status, configuration_version_id, completed_at)
       VALUES ($1, 'completed', $2, now())
       RETURNING qualification_session_id`,
      [seeded.leadId, seeded.configurationVersionId],
    );
    await db.pool.query(
      `INSERT INTO app.qualification_answers
        (qualification_session_id, question_key, normalized_value, raw_value, parser_source)
       VALUES ($1, 'q_location', 'New Cairo', 'New Cairo', 'free_text')`,
      [session.rows[0]?.qualification_session_id],
    );
    await db.pool.query(
      `UPDATE app.leads
       SET status='qualified', current_stage='qualified'
       WHERE lead_id=$1`,
      [seeded.leadId],
    );

    const service = new leadScoring.LeadScoringService();
    const first = await service.scoreLead(db.pool, {
      leadId: seeded.leadId,
      actorType: 'worker',
      actorId: 'test-worker',
      correlationId: 'test-score-missing',
    });
    const second = await service.scoreLead(db.pool, {
      leadId: seeded.leadId,
      actorType: 'worker',
      actorId: 'test-worker',
      correlationId: 'test-score-missing',
    });

    expect(second.scoreRunId).toBe(first.scoreRunId);
    expect(second.inserted).toBe(false);
    expect((await db.pool.query('SELECT lead_score, temperature FROM app.leads WHERE lead_id=$1', [seeded.leadId])).rows[0]).toEqual({
      lead_score: 20,
      temperature: 'cold',
    });
    expect((await db.pool.query('SELECT count(*) FROM app.score_runs WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
    const scoreRun = await db.pool.query<{ missing: string[] }>(
      `SELECT factors_json->'missingAnswers' AS missing
       FROM app.score_runs
       WHERE lead_id=$1`,
      [seeded.leadId],
    );
    expect(scoreRun.rows[0]?.missing).toEqual([
      'q_unit_type',
      'q_budget_min',
      'q_budget_max',
      'q_payment_plan',
      'q_down_payment',
      'q_timeline',
      'q_purpose',
      'q_site_visit',
    ]);
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='lead.scored' AND aggregate_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('routes scored leads by client/project eligibility with stable tie-breaks and idempotent notification enqueue', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'ROUTE',
      phone: '+201099999986',
      phoneNumberId: 'phone-number-id-mp09-route',
    });
    const alice = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople
        (client_id, legacy_airtable_id, name, phone_e164, active, priority_rank, unit_specialties, locations, languages)
       VALUES ($1, 'recROUTEALICE', 'Alice Route', '+201011111111', true, 10, ARRAY['Apartment'], ARRAY['New Cairo'], ARRAY['English'])
       RETURNING salesperson_id`,
      [seeded.clientId],
    );
    const bob = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople
        (client_id, legacy_airtable_id, name, phone_e164, active, priority_rank, unit_specialties, locations, languages)
       VALUES ($1, 'recROUTEBOB', 'Bob Route', '+201022222222', true, 10, ARRAY['Apartment'], ARRAY['New Cairo'], ARRAY['English'])
       RETURNING salesperson_id`,
      [seeded.clientId],
    );
    const otherClient = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ('client-mp09-cross', 'recMP09CROSSCLIENT', 'Cross Client')
       RETURNING client_id`,
    );
    const crossClientSalesperson = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople
        (client_id, legacy_airtable_id, name, phone_e164, active, priority_rank)
       VALUES ($1, 'recROUTECROSS', 'Aaron Cross Client', '+201033333333', true, 1)
       RETURNING salesperson_id`,
      [otherClient.rows[0]?.client_id],
    );
    await db.pool.query(
      `INSERT INTO app.salesperson_projects (salesperson_id, project_id)
       VALUES ($1,$3), ($2,$3), ($4,$3)`,
      [
        alice.rows[0]?.salesperson_id,
        bob.rows[0]?.salesperson_id,
        seeded.projectId,
        crossClientSalesperson.rows[0]?.salesperson_id,
      ],
    );
    const followups = new followupScheduler.FollowupSchedulerService();
    const scheduledFollowup = await followups.scheduleFollowup(db.pool, {
      leadId: seeded.leadId,
      stageKey: 'asking_location',
      sequenceKey: 'default',
      stepOrder: 1,
      delaySeconds: 3600,
      correlationId: 'route-test',
    });
    expect(scheduledFollowup.scheduled).toBe(true);
    const session = await db.pool.query<{ qualification_session_id: string }>(
      `INSERT INTO app.qualification_sessions
        (lead_id, status, configuration_version_id, completed_at)
       VALUES ($1, 'completed', $2, now())
       RETURNING qualification_session_id`,
      [seeded.leadId, seeded.configurationVersionId],
    );
    await db.pool.query(
      `INSERT INTO app.qualification_answers
        (qualification_session_id, question_key, normalized_value, raw_value, parser_source)
       VALUES
        ($1, 'q_location', 'New Cairo', 'New Cairo', 'free_text'),
        ($1, 'q_unit_type', 'Apartment', 'Apartment', 'option_id'),
        ($1, 'q_budget_min', '3000000', '3M - 5M', 'option_id'),
        ($1, 'q_budget_max', '5000000', '3M - 5M', 'option_id'),
        ($1, 'q_payment_plan', 'Installments', 'Installments', 'option_id'),
        ($1, 'q_down_payment', '500000', '500000', 'free_text'),
        ($1, 'q_timeline', '3 months', '3 months', 'option_id'),
        ($1, 'q_purpose', 'Primary Residence', 'Primary Residence', 'option_id'),
        ($1, 'q_site_visit', 'Yes', 'Yes', 'option_id')`,
      [session.rows[0]?.qualification_session_id],
    );
    await db.pool.query(
      `UPDATE app.leads
       SET status='qualified', current_stage='qualified'
       WHERE lead_id=$1`,
      [seeded.leadId],
    );

    const scorer = new leadScoring.LeadScoringService();
    const score = await scorer.scoreLead(db.pool, { leadId: seeded.leadId, correlationId: 'route-test' });
    const router = new leadRouting.LeadRoutingService();
    const first = await router.routeLead(db.pool, {
      leadId: seeded.leadId,
      scoreRunId: score.scoreRunId,
      correlationId: 'route-test',
    });
    const second = await router.routeLead(db.pool, {
      leadId: seeded.leadId,
      scoreRunId: score.scoreRunId,
      correlationId: 'route-test',
    });

    expect(first.outcome).toBe('assigned');
    expect(first.selectedSalespersonId).toBe(alice.rows[0]?.salesperson_id);
    expect(second.routingRunId).toBe(first.routingRunId);
    expect(second.inserted).toBe(false);
    expect((await db.pool.query('SELECT count(*) FROM app.lead_assignments WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='salesperson.lead_assignment_notification'")).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT status, cancelled_reason FROM app.followups WHERE followup_id=$1', [scheduledFollowup.followupId])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'lead_assigned',
    });
    expect((await db.pool.query('SELECT status, cancelled_reason FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [scheduledFollowup.scheduledJobId])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'lead_assigned',
    });
    const candidates = await db.pool.query<{ ids: string[] }>(
      `SELECT ARRAY(
         SELECT candidate->>'salespersonId'
         FROM app.routing_runs rr,
         LATERAL jsonb_array_elements(rr.candidates_json) AS candidate
         WHERE rr.lead_id=$1
         ORDER BY (candidate->>'rank')::integer
       ) AS ids`,
      [seeded.leadId],
    );
    expect(candidates.rows[0]?.ids).toEqual([alice.rows[0]?.salesperson_id, bob.rows[0]?.salesperson_id]);
    expect(candidates.rows[0]?.ids).not.toContain(crossClientSalesperson.rows[0]?.salesperson_id);
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='lead.routed' AND aggregate_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('records no-eligible routing decisions and alerts the operator idempotently', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'ROUTENO',
      phone: '+201099999985',
      phoneNumberId: 'phone-number-id-mp09-route-no',
    });
    await db.pool.query("UPDATE app.clients SET manager_phone_e164='+201099900000' WHERE client_id=$1", [seeded.clientId]);
    await db.pool.query(
      `UPDATE app.leads
       SET status='qualified', current_stage='qualified'
       WHERE lead_id=$1`,
      [seeded.leadId],
    );
    const scorer = new leadScoring.LeadScoringService();
    const score = await scorer.scoreLead(db.pool, {
      leadId: seeded.leadId,
      answers: {
        q_location: 'New Cairo',
        q_unit_type: 'Apartment',
        q_budget_min: '3000000',
        q_budget_max: '5000000',
        q_payment_plan: 'Installments',
        q_down_payment: '500000',
        q_timeline: '3 months',
        q_purpose: 'Primary Residence',
        q_site_visit: 'Yes',
      },
      correlationId: 'route-no-test',
    });
    const router = new leadRouting.LeadRoutingService();
    const first = await router.routeLead(db.pool, {
      leadId: seeded.leadId,
      scoreRunId: score.scoreRunId,
      correlationId: 'route-no-test',
    });
    const second = await router.routeLead(db.pool, {
      leadId: seeded.leadId,
      scoreRunId: score.scoreRunId,
      correlationId: 'route-no-test',
    });

    expect(first.outcome).toBe('no_eligible_salesperson');
    expect(second.routingRunId).toBe(first.routingRunId);
    expect((await db.pool.query('SELECT count(*) FROM app.lead_assignments WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('0');
    expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='operator.routing_attention_required'")).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='lead.routing_no_eligible' AND aggregate_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('schedules durable follow-up jobs idempotently with explicit timezone', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'FOLLOW',
      phone: '+201099999981',
      phoneNumberId: 'phone-number-id-mp10-follow',
    });
    await db.pool.query("UPDATE app.clients SET timezone='Africa/Cairo' WHERE client_id=$1", [seeded.clientId]);
    const service = new followupScheduler.FollowupSchedulerService();
    const first = await service.scheduleFollowup(db.pool, {
      leadId: seeded.leadId,
      stageKey: 'asking_location',
      sequenceKey: 'default',
      stepOrder: 1,
      delaySeconds: 900,
      correlationId: 'followup-test',
    });
    const second = await service.scheduleFollowup(db.pool, {
      leadId: seeded.leadId,
      stageKey: 'asking_location',
      sequenceKey: 'default',
      stepOrder: 1,
      delaySeconds: 900,
      correlationId: 'followup-test',
    });

    expect(second.followupId).toBe(first.followupId);
    expect(second.scheduledJobId).toBe(first.scheduledJobId);
    expect((await db.pool.query('SELECT count(*) FROM app.followups WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM runtime.scheduled_jobs WHERE job_key=$1', [first.jobKey])).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT timezone, job_type, aggregate_key FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [first.scheduledJobId])).rows[0]).toEqual({
      timezone: 'Africa/Cairo',
      job_type: 'followup.send',
      aggregate_key: seeded.leadId,
    });
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='followup.scheduled' AND aggregate_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('executes due follow-up jobs once through the runtime worker', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'FOLLOWEXEC',
      phone: '+201099999980',
      phoneNumberId: 'phone-number-id-mp10-follow-exec',
    });
    const scheduler = new followupScheduler.FollowupSchedulerService();
    const scheduled = await scheduler.scheduleFollowup(db.pool, {
      leadId: seeded.leadId,
      stageKey: 'asking_location',
      delaySeconds: 0,
      correlationId: 'followup-exec-test',
    });
    await db.pool.query('UPDATE runtime.scheduled_jobs SET due_at=now()-interval \'1 second\' WHERE scheduled_job_id=$1', [scheduled.scheduledJobId]);

    const processor = new followupJob.FollowupJobProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => processor.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);
    expect(await worker.tick()).toBe(0);

    expect((await db.pool.query('SELECT status, sent_message_id IS NOT NULL AS has_message FROM app.followups WHERE followup_id=$1', [scheduled.followupId])).rows[0]).toEqual({
      status: 'sent',
      has_message: true,
    });
    expect((await db.pool.query('SELECT status FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [scheduled.scheduledJobId])).rows[0]?.status).toBe('completed');
    expect((await db.pool.query("SELECT count(*) FROM app.messages WHERE direction='outbound' AND lead_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'")).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='followup.sent' AND aggregate_id=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('does not execute cancelled follow-up jobs', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'FOLLOWCANCEL',
      phone: '+201099999979',
      phoneNumberId: 'phone-number-id-mp10-follow-cancel',
    });
    const scheduler = new followupScheduler.FollowupSchedulerService();
    const scheduled = await scheduler.scheduleFollowup(db.pool, {
      leadId: seeded.leadId,
      stageKey: 'asking_location',
      delaySeconds: 0,
      correlationId: 'followup-cancel-test',
    });
    await scheduler.cancelForLead(db.pool, {
      leadId: seeded.leadId,
      reason: 'test_cancel',
      correlationId: 'followup-cancel-test',
    });
    await db.pool.query('UPDATE runtime.scheduled_jobs SET due_at=now()-interval \'1 second\' WHERE scheduled_job_id=$1', [scheduled.scheduledJobId]);

    const processor = new followupJob.FollowupJobProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => processor.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(0);

    expect((await db.pool.query('SELECT status, cancelled_reason FROM app.followups WHERE followup_id=$1', [scheduled.followupId])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'test_cancel',
    });
    expect((await db.pool.query('SELECT count(*) FROM app.messages WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
  });

  it('recovers expired follow-up job leases before execution', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'FOLLOWLEASE',
      phone: '+201099999978',
      phoneNumberId: 'phone-number-id-mp10-follow-lease',
    });
    const scheduler = new followupScheduler.FollowupSchedulerService();
    const scheduled = await scheduler.scheduleFollowup(db.pool, {
      leadId: seeded.leadId,
      stageKey: 'asking_location',
      delaySeconds: 0,
      correlationId: 'followup-lease-test',
    });
    await db.pool.query(
      `UPDATE runtime.scheduled_jobs
       SET status='processing',
           locked_by='abandoned-worker',
           lock_expires_at=now()-interval '1 second',
           due_at=now()-interval '1 second'
       WHERE scheduled_job_id=$1`,
      [scheduled.scheduledJobId],
    );

    const processor = new followupJob.FollowupJobProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => processor.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);
    expect((await db.pool.query('SELECT status FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [scheduled.scheduledJobId])).rows[0]?.status).toBe('completed');
    expect((await db.pool.query('SELECT count(*) FROM app.messages WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('schedules assignment SLA jobs idempotently and cancels them on acknowledgement', async () => {
    const assigned = await seedAssignedLead({
      suffix: 'SLAACK',
      phone: '+201099999977',
      salespersonPhone: '+201088888881',
    });
    const service = new slaService.SlaService();
    const first = await service.scheduleForAssignment(db.pool, {
      leadAssignmentId: assigned.assignmentId,
      correlationId: 'sla-ack-test',
    });
    const second = await service.scheduleForAssignment(db.pool, {
      leadAssignmentId: assigned.assignmentId,
      correlationId: 'sla-ack-test',
    });

    expect(first.map((job) => job.scheduled)).toEqual([true, true]);
    expect(second.map((job) => job.slaJobId)).toEqual(first.map((job) => job.slaJobId));
    expect((await db.pool.query('SELECT count(*) FROM app.sla_jobs WHERE lead_id=$1', [assigned.leadId])).rows[0]?.count).toBe('2');
    expect((await db.pool.query("SELECT count(*) FROM runtime.scheduled_jobs WHERE job_type='sla.notify' AND aggregate_key=$1", [assigned.leadId])).rows[0]?.count).toBe('2');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='sla.scheduled' AND aggregate_id=$1", [assigned.leadId])).rows[0]?.count).toBe('2');

    await receiveSalespersonCommand({
      clientId: assigned.clientId,
      leadId: assigned.leadId,
      assignmentId: assigned.assignmentId,
      fromE164: '+201088888881',
      messageText: 'ACK',
      sourceEventId: 'sla-ack-command-1',
    });
    const processor = new metaInbox.MetaInboxProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processInbox: (event) => processor.process(event) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);

    expect((await db.pool.query('SELECT acknowledged_at IS NOT NULL AS acknowledged FROM app.lead_assignments WHERE lead_assignment_id=$1', [assigned.assignmentId])).rows[0]?.acknowledged).toBe(true);
    expect((await db.pool.query("SELECT count(*) FROM app.sla_jobs WHERE lead_assignment_id=$1 AND status='cancelled' AND cancelled_reason='assignment_acknowledged'", [assigned.assignmentId])).rows[0]?.count).toBe('2');
    expect((await db.pool.query("SELECT count(*) FROM runtime.scheduled_jobs WHERE aggregate_key=$1 AND job_type='sla.notify' AND status='cancelled'", [assigned.leadId])).rows[0]?.count).toBe('2');
  });

  it('executes due assignment SLA reminders and escalations idempotently', async () => {
    const assigned = await seedAssignedLead({
      suffix: 'SLAEXEC',
      phone: '+201099999976',
      salespersonPhone: '+201088888882',
    });
    await db.pool.query("UPDATE app.clients SET manager_phone_e164='+201099900001' WHERE client_id=$1", [assigned.clientId]);
    const service = new slaService.SlaService();
    await service.scheduleForAssignment(db.pool, {
      leadAssignmentId: assigned.assignmentId,
      correlationId: 'sla-exec-test',
    });
    await db.pool.query(
      "UPDATE runtime.scheduled_jobs SET due_at=now()-interval '1 second' WHERE job_type='sla.notify' AND aggregate_key=$1",
      [assigned.leadId],
    );

    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => service.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(2);
    expect(await worker.tick()).toBe(0);

    expect((await db.pool.query("SELECT count(*) FROM app.sla_jobs WHERE lead_id=$1 AND status='sent'", [assigned.leadId])).rows[0]?.count).toBe('2');
    const commands = await db.pool.query<{ command_type: string; destination: string }>(
      `SELECT command_type, destination
       FROM runtime.outbox_commands
       WHERE aggregate_key=$1
       ORDER BY command_type`,
      [assigned.leadId],
    );
    expect(commands.rows).toEqual([
      { command_type: 'operator.sla_escalation', destination: '+201099900001' },
      { command_type: 'salesperson.sla_assignment_reminder', destination: '+201088888882' },
    ]);
    expect((await db.pool.query("SELECT count(*) FROM runtime.scheduled_jobs WHERE job_type='sla.notify' AND aggregate_key=$1 AND status='completed'", [assigned.leadId])).rows[0]?.count).toBe('2');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='sla.sent' AND aggregate_id=$1", [assigned.leadId])).rows[0]?.count).toBe('2');
  });

  it('recovers expired stale-qualified SLA job leases before escalation', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'SLALEASE',
      phone: '+201099999975',
      phoneNumberId: 'phone-number-id-mp10-sla-lease',
    });
    await db.pool.query("UPDATE app.clients SET manager_phone_e164='+201099900002' WHERE client_id=$1", [seeded.clientId]);
    await db.pool.query(
      "UPDATE app.leads SET status='qualified', current_stage='qualified' WHERE lead_id=$1",
      [seeded.leadId],
    );
    const service = new slaService.SlaService();
    const scheduled = await service.scheduleStaleQualifiedLead(db.pool, {
      leadId: seeded.leadId,
      delaySeconds: 0,
      correlationId: 'sla-lease-test',
    });
    await db.pool.query(
      `UPDATE runtime.scheduled_jobs
       SET status='processing',
           locked_by='abandoned-worker',
           lock_expires_at=now()-interval '1 second',
           due_at=now()-interval '1 second'
       WHERE scheduled_job_id=$1`,
      [scheduled.scheduledJobId],
    );

    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => service.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);
    expect((await db.pool.query("SELECT status FROM app.sla_jobs WHERE sla_job_id=$1", [scheduled.slaJobId])).rows[0]?.status).toBe('sent');
    expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='operator.sla_escalation' AND aggregate_key=$1", [seeded.leadId])).rows[0]?.count).toBe('1');
  });

  it('cancels stale-qualified SLA jobs that no longer qualify at execution time', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'SLACANCEL',
      phone: '+201099999974',
      phoneNumberId: 'phone-number-id-mp10-sla-cancel',
    });
    await db.pool.query("UPDATE app.clients SET manager_phone_e164='+201099900003' WHERE client_id=$1", [seeded.clientId]);
    await db.pool.query(
      "UPDATE app.leads SET status='qualified', current_stage='qualified' WHERE lead_id=$1",
      [seeded.leadId],
    );
    const service = new slaService.SlaService();
    const scheduled = await service.scheduleStaleQualifiedLead(db.pool, {
      leadId: seeded.leadId,
      delaySeconds: 0,
      correlationId: 'sla-cancel-test',
    });
    await db.pool.query(
      "UPDATE app.leads SET status='lost', current_stage='closed_lost', stop_follow_up=true WHERE lead_id=$1",
      [seeded.leadId],
    );
    await db.pool.query('UPDATE runtime.scheduled_jobs SET due_at=now()-interval \'1 second\' WHERE scheduled_job_id=$1', [scheduled.scheduledJobId]);

    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => service.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);
    expect((await db.pool.query('SELECT status, cancelled_reason FROM app.sla_jobs WHERE sla_job_id=$1', [scheduled.slaJobId])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'stop_follow_up_true',
    });
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands WHERE aggregate_key=$1', [seeded.leadId])).rows[0]?.count).toBe('0');
  });

  it('schedules daily report jobs idempotently with explicit timezone', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'REPORTSCHED',
      phone: '+201099999973',
      phoneNumberId: 'phone-number-id-mp10-report-schedule',
    });
    await db.pool.query("UPDATE app.clients SET timezone='Africa/Cairo', manager_phone_e164='+201099900004' WHERE client_id=$1", [seeded.clientId]);
    const service = new reportingService.ReportingService();
    const reportDate = todayInCairo();
    const first = await service.scheduleDailyReport(db.pool, {
      clientId: seeded.clientId,
      reportDate,
      correlationId: 'report-schedule-test',
    });
    const second = await service.scheduleDailyReport(db.pool, {
      clientId: seeded.clientId,
      reportDate,
      correlationId: 'report-schedule-test',
    });

    expect(second.dailyReportId).toBe(first.dailyReportId);
    expect(second.scheduledJobId).toBe(first.scheduledJobId);
    expect((await db.pool.query('SELECT count(*) FROM app.daily_reports WHERE client_id=$1', [seeded.clientId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT timezone, job_type, aggregate_key FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [first.scheduledJobId])).rows[0]).toEqual({
      timezone: 'Africa/Cairo',
      job_type: 'report.daily',
      aggregate_key: seeded.clientId,
    });
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='report.daily_scheduled' AND aggregate_id=$1", [seeded.clientId])).rows[0]?.count).toBe('1');
  });

  it('does not execute cancelled daily report jobs', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'REPORTCANCEL',
      phone: '+201099999972',
      phoneNumberId: 'phone-number-id-mp10-report-cancel',
    });
    await db.pool.query("UPDATE app.clients SET timezone='Africa/Cairo', manager_phone_e164='+201099900005' WHERE client_id=$1", [seeded.clientId]);
    const service = new reportingService.ReportingService();
    const scheduled = await service.scheduleDailyReport(db.pool, {
      clientId: seeded.clientId,
      reportDate: todayInCairo(),
      dueAt: new Date().toISOString(),
      correlationId: 'report-cancel-test',
    });
    await service.cancelDailyReport(db.pool, {
      dailyReportId: scheduled.dailyReportId,
      reason: 'operator_superseded',
      correlationId: 'report-cancel-test',
    });
    await db.pool.query('UPDATE runtime.scheduled_jobs SET due_at=now()-interval \'1 second\' WHERE scheduled_job_id=$1', [scheduled.scheduledJobId]);

    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => service.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(0);
    expect((await db.pool.query('SELECT status, cancelled_reason FROM app.daily_reports WHERE daily_report_id=$1', [scheduled.dailyReportId])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'operator_superseded',
    });
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
  });

  it('recovers expired daily report leases and generates accurate idempotent summaries', async () => {
    const assigned = await seedAssignedLead({
      suffix: 'REPORTEXEC',
      phone: '+201099999971',
      salespersonPhone: '+201088888883',
    });
    await db.pool.query("UPDATE app.clients SET timezone='Africa/Cairo', manager_phone_e164='+201099900006' WHERE client_id=$1", [assigned.clientId]);
    await db.pool.query(
      `INSERT INTO app.lead_intake_events
        (lead_id, client_id, provider, provider_external_id, idempotency_key, payload_json)
       VALUES ($1, $2, 'website', 'report-provider-id', 'report-intake-id', $3::jsonb)`,
      [assigned.leadId, assigned.clientId, JSON.stringify({ clientId: assigned.clientId })],
    );
    await db.pool.query(
      `INSERT INTO app.qualification_sessions (lead_id, status, completed_at)
       VALUES ($1, 'completed', now())`,
      [assigned.leadId],
    );
    await db.pool.query(
      `INSERT INTO app.sla_jobs
        (lead_id, lead_assignment_id, client_id, salesperson_id, semantic_key, sla_type, status, due_at, timezone)
       VALUES ($1, $2, $3, $4, $5, 'assignment_ack_escalation', 'sent', now(), 'Africa/Cairo')`,
      [assigned.leadId, assigned.assignmentId, assigned.clientId, assigned.salespersonId, `sla:report:${assigned.leadId}`],
    );
    await db.pool.query(
      `INSERT INTO app.followups (lead_id, status, due_at, semantic_key, timezone, sequence_key, step_order)
       VALUES
        ($1, 'sent', now(), $2, 'Africa/Cairo', 'report', 1),
        ($1, 'cancelled', now(), $3, 'Africa/Cairo', 'report', 2)`,
      [assigned.leadId, `followup:report:${assigned.leadId}:sent`, `followup:report:${assigned.leadId}:cancelled`],
    );
    await db.pool.query(
      `INSERT INTO app.messages
        (lead_id, client_id, direction, channel, to_address, message_text, message_type, state)
       VALUES ($1, $2, 'outbound', 'whatsapp', '+201099999971', 'Report message', 'text', 'delivered')`,
      [assigned.leadId, assigned.clientId],
    );
    await db.pool.query(
      `INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
       VALUES ('runtime.outbox_commands', $1, 'report test dead letter', $2::jsonb)`,
      [assigned.leadId, JSON.stringify({ clientId: assigned.clientId })],
    );

    const service = new reportingService.ReportingService();
    const scheduled = await service.scheduleDailyReport(db.pool, {
      clientId: assigned.clientId,
      reportDate: todayInCairo(),
      dueAt: new Date().toISOString(),
      correlationId: 'report-exec-test',
    });
    await db.pool.query(
      `UPDATE runtime.scheduled_jobs
       SET status='processing',
           locked_by='abandoned-worker',
           lock_expires_at=now()-interval '1 second',
           due_at=now()-interval '1 second'
       WHERE scheduled_job_id=$1`,
      [scheduled.scheduledJobId],
    );

    const worker = new runtimeWorker.RuntimeWorker(
      { processJob: (job) => service.process(job) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);
    expect(await worker.tick()).toBe(0);

    const report = await db.pool.query<{ status: string; summary_json: Record<string, unknown> }>(
      'SELECT status, summary_json FROM app.daily_reports WHERE daily_report_id=$1',
      [scheduled.dailyReportId],
    );
    expect(report.rows[0]?.status).toBe('sent');
    expect(report.rows[0]?.summary_json).toMatchObject({
      leadIntakeCount: 1,
      newLeadCount: 1,
      qualifiedLeadCount: 1,
      assignedLeadCount: 1,
      acknowledgedAssignmentCount: 0,
      unacknowledgedActiveAssignmentCount: 1,
      slaEscalationCount: 1,
      followupSentCount: 1,
      followupCancelledCount: 1,
      outboundMessageCount: 1,
      deliveredMessageCount: 1,
      failedMessageCount: 0,
      deadLetterCount: 1,
    });
    expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='operator.daily_report' AND aggregate_key=$1", [assigned.clientId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='report.daily_sent' AND aggregate_id=$1", [assigned.clientId])).rows[0]?.count).toBe('1');
  });

  it('receives duplicate salesperson acknowledge commands durably and processes one authorized effect', async () => {
    const assigned = await seedAssignedLead({
      suffix: 'CMDACK',
      phone: '+201099999984',
      salespersonPhone: '+201044444444',
    });

    await receiveSalespersonCommand({
      clientId: assigned.clientId,
      leadId: assigned.leadId,
      assignmentId: assigned.assignmentId,
      fromE164: '+201044444444',
      messageText: 'ACK',
      sourceEventId: 'cmd-ack-1',
    });
    await receiveSalespersonCommand({
      clientId: assigned.clientId,
      leadId: assigned.leadId,
      assignmentId: assigned.assignmentId,
      fromE164: '+201044444444',
      messageText: 'ACK',
      sourceEventId: 'cmd-ack-1',
      expectedDuplicate: true,
    });

    const processor = new metaInbox.MetaInboxProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processInbox: (event) => processor.process(event) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);

    expect((await db.pool.query('SELECT acknowledged_at IS NOT NULL AS acknowledged FROM app.lead_assignments WHERE lead_assignment_id=$1', [assigned.assignmentId])).rows[0]?.acknowledged).toBe(true);
    expect((await db.pool.query("SELECT count(*) FROM app.salesperson_commands WHERE status='processed' AND command_intent='acknowledge'")).rows[0]?.count).toBe('1');
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='salesperson.command_processed' AND aggregate_id=$1", [assigned.leadId])).rows[0]?.count).toBe('1');
  });

  it('rejects salesperson commands when the sender is not the active assignee', async () => {
    const assigned = await seedAssignedLead({
      suffix: 'CMDBAD',
      phone: '+201099999983',
      salespersonPhone: '+201055555555',
    });
    await db.pool.query(
      `INSERT INTO app.salespeople
        (client_id, legacy_airtable_id, name, phone_e164, active, priority_rank)
       VALUES ($1, 'recCMDBADOTHER', 'Wrong Sender', '+201066666666', true, 1)`,
      [assigned.clientId],
    );

    await receiveSalespersonCommand({
      clientId: assigned.clientId,
      leadId: assigned.leadId,
      assignmentId: assigned.assignmentId,
      fromE164: '+201066666666',
      messageText: 'ACK',
      sourceEventId: 'cmd-bad-1',
    });

    const processor = new metaInbox.MetaInboxProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processInbox: (event) => processor.process(event) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);

    expect((await db.pool.query('SELECT acknowledged_at FROM app.lead_assignments WHERE lead_assignment_id=$1', [assigned.assignmentId])).rows[0]?.acknowledged_at).toBeNull();
    expect((await db.pool.query('SELECT status, outcome_reason FROM app.salesperson_commands')).rows[0]).toEqual({
      status: 'rejected',
      outcome_reason: 'sender_not_active_assignee',
    });
    expect((await db.pool.query("SELECT count(*) FROM audit.events WHERE event_type='salesperson.command_rejected' AND aggregate_id=$1", [assigned.leadId])).rows[0]?.count).toBe('1');
  });

  it('processes authorized close-lost salesperson commands without external side effects', async () => {
    const assigned = await seedAssignedLead({
      suffix: 'CMDLOST',
      phone: '+201099999982',
      salespersonPhone: '+201077777777',
    });
    const scheduledJobId = await new runtime.JobRepository().schedule(db.pool, {
      jobKey: `followup:${assigned.leadId}:manual:asking_location:step:1`,
      jobType: 'followup.send',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      timezone: 'Africa/Cairo',
      aggregateKey: assigned.leadId,
      payload: { leadId: assigned.leadId },
    });
    const followup = await db.pool.query<{ followup_id: string }>(
      `INSERT INTO app.followups
        (lead_id, status, due_at, semantic_key, scheduled_job_id, timezone, sequence_key, step_order)
       VALUES ($1, 'scheduled', now()+interval '1 hour', $2, $3, 'Africa/Cairo', 'manual', 1)
       RETURNING followup_id`,
      [assigned.leadId, `followup:${assigned.leadId}:manual:asking_location:step:1`, scheduledJobId],
    );

    await receiveSalespersonCommand({
      clientId: assigned.clientId,
      leadId: assigned.leadId,
      assignmentId: assigned.assignmentId,
      fromE164: '+201077777777',
      messageText: 'close lost',
      sourceEventId: 'cmd-lost-1',
    });

    const processor = new metaInbox.MetaInboxProcessor();
    const worker = new runtimeWorker.RuntimeWorker(
      { processInbox: (event) => processor.process(event) },
      { enabled: true, batchSize: 10 },
    );
    expect(await worker.tick()).toBe(1);

    expect((await db.pool.query('SELECT status, current_stage, closed_status, stop_follow_up, stop_reason FROM app.leads WHERE lead_id=$1', [assigned.leadId])).rows[0]).toEqual({
      status: 'lost',
      current_stage: 'closed_lost',
      closed_status: 'lost',
      stop_follow_up: true,
      stop_reason: 'salesperson_command',
    });
    expect((await db.pool.query('SELECT status, current_stage, closed_status, stop_follow_up FROM edge_conversations WHERE lead_id=$1', [assigned.leadId])).rows[0]).toEqual({
      status: 'lost',
      current_stage: 'closed_lost',
      closed_status: 'lost',
      stop_follow_up: true,
    });
    expect((await db.pool.query('SELECT status, cancelled_reason FROM app.followups WHERE followup_id=$1', [followup.rows[0]?.followup_id])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'salesperson_close_lost',
    });
    expect((await db.pool.query('SELECT status, cancelled_reason FROM runtime.scheduled_jobs WHERE scheduled_job_id=$1', [scheduledJobId])).rows[0]).toEqual({
      status: 'cancelled',
      cancelled_reason: 'salesperson_close_lost',
    });
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
  });

  it('completes Arabic qualification from the final site-visit answer', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'COMPLETEAR',
      phone: '+201099999988',
      phoneNumberId: 'phone-number-id-mp08-complete-ar',
      preferredLanguage: 'Arabic',
      currentStage: 'asking_site_visit',
      currentQuestionKey: 'q_site_visit',
      answers: {
        q_location: 'القاهرة الجديدة',
        q_unit_type: 'Apartment',
        q_budget_min: '3000000',
        q_budget_max: '5000000',
        q_payment_plan: 'Installments',
        q_down_payment: '500000',
        q_timeline: '3 months',
        q_purpose: 'Investment',
      },
    });

    await receiveAndProcessMetaInbound({
      providerMessageId: 'wamid.mp08.complete.ar.inbound.1',
      from: '+201099999988',
      phoneNumberId: 'phone-number-id-mp08-complete-ar',
      text: 'أيوه، يا ريت',
    });

    expect((await db.pool.query(
      `SELECT status, current_stage, answers_json->>'q_site_visit' AS site_visit
       FROM edge_conversations
       WHERE lead_id=$1`,
      [seeded.leadId],
    )).rows[0]).toEqual({
      status: 'qualified',
      current_stage: 'qualified',
      site_visit: 'Yes',
    });
    expect((await db.pool.query(
      `SELECT s.status, a.normalized_value
       FROM app.qualification_sessions s
       JOIN app.qualification_answers a USING (qualification_session_id)
       WHERE s.lead_id=$1 AND a.question_key='q_site_visit'`,
      [seeded.leadId],
    )).rows[0]).toEqual({
      status: 'completed',
      normalized_value: 'Yes',
    });
  });

  it('ignores legacy-owned inbound conversations so Typebot fallback remains authoritative during cutover', async () => {
    await db.pool.query('TRUNCATE edge_active_turns, edge_message_events, edge_conversations, edge_client_channels, edge_config_snapshots RESTART IDENTITY CASCADE');
    const service = new versionedConfig.VersionedConfigService();
    const published = await service.publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId: 'recMP08LEGACY',
      publishedBy: 'test-operator',
    });
    await db.pool.query(
      `INSERT INTO edge_client_channels
        (phone_number_id, client_record_id, client_id, company_name, active, config_version, direct_send_enabled, graph_phone_number_id)
       VALUES ('phone-number-id-mp08-legacy', 'recMP08LEGACY', 'legacy-client-id', 'MP08 Legacy Client', true, $1, true, 'phone-number-id-mp08-legacy')`,
      [published.versionKey],
    );
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, project_name, project_record_id, preferred_language, current_stage,
         current_question_key, answers_json, status, conversation_engine, state_authority,
         config_version, configuration_version_id)
       VALUES (
         'recMP08LEGACY', 'legacy-client-id', '+201099999996', 'recMP08LEGACYLEAD', 'legacy-lead-id', 'Legacy Lead',
         'MP08 Legacy Client', 'Legacy Project', 'recMP08LEGACYPROJECT', 'English', 'asking_location',
         'q_location', '{}'::jsonb, 'in_qualification', 'legacy', 'legacy', $1, $2
       )`,
      [published.versionKey, published.configurationVersionId],
    );

    const app = await appModule.buildApp();
    try {
      const payload = metaInboundPayload({
        providerMessageId: 'wamid.mp08.legacy.inbound.1',
        from: '+201099999996',
        phoneNumberId: 'phone-number-id-mp08-legacy',
        text: 'New Cairo',
      });
      const signed = signedMetaWebhook(payload);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signed.signature,
        },
        payload: signed.rawBody,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, received: 1, duplicates: 0 });

      const processor = new metaInbox.MetaInboxProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);
      expect((await db.pool.query("SELECT status, ignored_reason FROM runtime.inbox_events WHERE event_type='whatsapp.message_received'")).rows[0]).toMatchObject({
        status: 'ignored',
        ignored_reason: 'conversation_owned_by_legacy',
      });
      expect((await db.pool.query('SELECT count(*) FROM edge_active_turns')).rows[0]?.count).toBe('0');
      expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('0');
      expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
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

  it('receives n8n-compatible inbound WhatsApp messages through durable inbox', async () => {
    const seeded = await seedMp08Conversation({
      suffix: 'N8NINBOUND',
      phone: '+201099999987',
      phoneNumberId: 'phone-number-id-mp08-n8n-inbound',
    });

    const app = await appModule.buildApp();
    try {
      const payload = {
        clientRecordId: 'recMP08N8NINBOUND',
        sourceEventId: 'n8n-inbound-mp08-001',
        phoneNumberId: 'phone-number-id-mp08-n8n-inbound',
        phoneNormalized: '+201099999987',
        messageType: 'text',
        messageText: 'New Cairo',
        receivedAt: '2026-07-30T03:00:00.000Z',
        profileName: 'n8n Lead',
        rawPayload: { workflow: 'sanitized-n8n-inbound' },
      };
      const first = await app.inject({
        method: 'POST',
        url: '/compat/n8n/messages/whatsapp/inbound',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload,
      });
      const duplicate = await app.inject({
        method: 'POST',
        url: '/compat/n8n/messages/whatsapp/inbound',
        headers: { 'x-internal-secret': env.EDGE_INTERNAL_SECRET },
        payload,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ ok: true, received: 1, duplicate: false, clientId: seeded.clientId });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.json()).toMatchObject({ ok: true, received: 1, duplicate: true, clientId: seeded.clientId });
      expect((await db.pool.query("SELECT count(*) FROM runtime.inbox_events WHERE provider='n8n' AND event_type='whatsapp.message_received'")).rows[0]?.count).toBe('1');

      const processor = new metaInbox.MetaInboxProcessor();
      const worker = new runtimeWorker.RuntimeWorker(
        { processInbox: (event) => processor.process(event) },
        { enabled: true, batchSize: 10 },
      );
      expect(await worker.tick()).toBe(1);
      expect((await db.pool.query(
        `SELECT current_stage, current_question_key, answers_json->>'q_location' AS q_location
         FROM edge_conversations
         WHERE lead_id=$1`,
        [seeded.leadId],
      )).rows[0]).toEqual({
        current_stage: 'asking_unit_type',
        current_question_key: 'q_unit_type',
        q_location: 'New Cairo',
      });
      expect((await db.pool.query("SELECT count(*) FROM app.messages WHERE direction='inbound' AND provider_message_id='n8n-inbound-mp08-001'")).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM app.messages WHERE direction='outbound' AND state='queued'")).rows[0]?.count).toBe('1');
      expect((await db.pool.query("SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'")).rows[0]?.count).toBe('1');
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
