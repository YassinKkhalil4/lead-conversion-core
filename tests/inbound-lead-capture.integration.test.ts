import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

describePg('direct WhatsApp inbound lead capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-inbound-test.'));
  const dataDir = join(root, 'data');
  const port = 58_400 + Math.floor(Math.random() * 900);
  const dbName = 'lead_core_inbound_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    EDGE_SHARED_SECRET: 'test_shared_secret_123456',
    EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
    META_APP_SECRET: 'test_meta_app_secret_123456',
    META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token_123456',
    META_APPROVED_TEMPLATE_NAMES: 'lead_welcome',
    DIRECT_META_WEBHOOK_ENABLED: 'true',
    META_STATUS_PROCESSOR_ENABLED: 'true',
    DIRECT_LEAD_INGRESS_ENABLED: 'true',
    RUNTIME_WORKER_ENABLED: 'true',
  };

  let db: typeof import('../src/db/pool.js');
  let runtime: typeof import('../src/infrastructure/runtime.js');
  let processorModule: typeof import('../src/services/edge-inbound-message-processor.js');
  let captureModule: typeof import('../src/services/inbound-lead-capture-service.js');
  let activationModule: typeof import('../src/services/conversation-activation-service.js');
  let leadIntake: typeof import('../src/services/lead-intake-service.js');
  let configEnv: typeof import('../src/config/env.js');
  let versionedConfig: typeof import('../src/configuration/versioned-config-service.js');

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${root}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
    for (const [key, value] of Object.entries(env)) process.env[key] = value as string;

    db = await import('../src/db/pool.js');
    runtime = await import('../src/infrastructure/runtime.js');
    processorModule = await import('../src/services/edge-inbound-message-processor.js');
    captureModule = await import('../src/services/inbound-lead-capture-service.js');
    activationModule = await import('../src/services/conversation-activation-service.js');
    leadIntake = await import('../src/services/lead-intake-service.js');
    configEnv = await import('../src/config/env.js');
    versionedConfig = await import('../src/configuration/versioned-config-service.js');
  }, 60_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE
        edge_active_turns, edge_message_events, edge_conversations,
        edge_client_channels, edge_lead_controls,
        runtime.outbox_commands, runtime.inbox_events, runtime.webhook_receipts,
        runtime.scheduled_jobs, runtime.dead_letters,
        audit.events,
        configuration.active_versions, configuration.versions,
        app.lead_capture_attempts, app.lead_intake_events,
        app.messages, app.leads, app.salespeople, app.contacts,
        app.projects, app.clients
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
        // Cleanup continues even if the cluster is already gone.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  const PHONE_NUMBER_ID = 'phone-number-id-inbound';
  const CLIENT_RECORD_ID = 'recINBOUNDCLIENT';

  type Seeded = { clientId: string; versionKey: string; configurationVersionId: string };

  async function seedClient(input?: {
    managerPhone?: string;
    channelClientId?: string;
    withChannel?: boolean;
    clientRecordIdOnChannel?: string;
  }): Promise<Seeded> {
    const published = await new versionedConfig.VersionedConfigService().publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId: CLIENT_RECORD_ID,
      publishedBy: 'test-operator',
    });
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name, manager_phone_e164)
       VALUES ('client-inbound', $1, 'Inbound Realty', $2)
       RETURNING client_id`,
      [CLIENT_RECORD_ID, input?.managerPhone ?? ''],
    );
    const clientId = client.rows[0]?.client_id || '';
    if (input?.withChannel !== false) {
      await db.pool.query(
        `INSERT INTO edge_client_channels
          (phone_number_id, client_record_id, client_id, company_name, active, config_version,
           direct_send_enabled, graph_phone_number_id)
         VALUES ($1, $2, $3, 'Inbound Realty', true, $4, true, $1)`,
        [
          PHONE_NUMBER_ID,
          input?.clientRecordIdOnChannel ?? CLIENT_RECORD_ID,
          input?.channelClientId ?? '',
          published.versionKey,
        ],
      );
    }
    return {
      clientId,
      versionKey: published.versionKey,
      configurationVersionId: published.configurationVersionId,
    };
  }

  function buildProcessor(capture?: InstanceType<typeof captureModule.InboundLeadCaptureService>) {
    if (!capture) return new processorModule.EdgeInboundMessageProcessor();
    return new processorModule.EdgeInboundMessageProcessor(
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, capture,
    );
  }

  async function deliver(input: {
    from: string;
    text?: string;
    metaMessageId?: string;
    phoneNumberId?: string;
    profileName?: string;
    processor?: ReturnType<typeof buildProcessor>;
  }) {
    const processor = input.processor ?? buildProcessor();
    const metaMessageId = input.metaMessageId ?? `wamid.${randomUUID()}`;
    return processor.process({
      inboxEventId: randomUUID(),
      provider: 'meta',
      eventType: 'whatsapp.message_received',
      dedupeKey: `meta:whatsapp_message:${metaMessageId}`,
      attemptCount: 1,
      payload: {
        webhookType: 'whatsapp.message_received',
        phoneNumberId: input.phoneNumberId ?? PHONE_NUMBER_ID,
        metaMessageId,
        from: input.from,
        messageType: 'text',
        messageText: input.text ?? 'Hello',
        messageOptionId: '',
        receivedAt: new Date().toISOString(),
        profileName: input.profileName ?? 'Walk In',
        rawMessage: {},
      },
    });
  }

  async function outboundText(leadPhone: string): Promise<{ text: string; kind: string }> {
    const result = await db.pool.query<{ message_text: string; message_type: string }>(
      `SELECT message_text, message_type FROM app.messages
       WHERE direction='outbound' AND to_address=$1 ORDER BY created_at DESC LIMIT 1`,
      [leadPhone],
    );
    return { text: result.rows[0]?.message_text || '', kind: result.rows[0]?.message_type || '' };
  }

  it('captures an unknown number as a lead and asks question one', async () => {
    const seeded = await seedClient();
    const phone = '+201125337755';

    expect(await deliver({ from: phone, text: 'مرحبا, عايز اعرف عن المشروع' })).toEqual({ outcome: 'processed' });

    const lead = await db.pool.query<Record<string, string>>(
      'SELECT lead_id, source, provider, provider_external_id, status FROM app.leads WHERE client_id=$1',
      [seeded.clientId],
    );
    expect(lead.rows).toHaveLength(1);
    expect(lead.rows[0]).toMatchObject({
      source: 'whatsapp_direct_inbound',
      provider: 'whatsapp',
      provider_external_id: phone,
      status: 'new',
    });

    expect((await db.pool.query('SELECT count(*) FROM app.contacts WHERE phone_e164=$1', [phone])).rows[0]?.count).toBe('1');

    const conversation = await db.pool.query<{ current_stage: string; preferred_language: string }>(
      'SELECT current_stage, preferred_language FROM edge_conversations WHERE phone_normalized=$1',
      [phone],
    );
    expect(conversation.rows[0]).toEqual({
      current_stage: 'language_selection',
      preferred_language: '',
    });

    // Greeting and language prompt arrive as one interactive message.
    const reply = await outboundText(phone);
    expect(reply.kind).toBe('buttons');
    expect(reply.text).toContain('Thanks for reaching out');
    expect(reply.text).toContain('شكراً لتواصلك');
    expect(reply.text).toContain('Please choose your preferred language');
    expect((await db.pool.query(
      `SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'`,
    )).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT count(*) FROM audit.events WHERE event_type='lead.captured_from_inbound'`,
    )).rows[0]?.count).toBe('1');
  });

  it('stores the opening message on the intake event without parsing it into answers', async () => {
    const seeded = await seedClient();
    const phone = '+201125337756';
    const opening = 'عايز شقة في التجمع بـ 4 مليون';

    await deliver({ from: phone, text: opening });

    const intake = await db.pool.query<{ payload_json: Record<string, unknown>; provider: string }>(
      'SELECT payload_json, provider FROM app.lead_intake_events WHERE client_id=$1',
      [seeded.clientId],
    );
    expect(intake.rows).toHaveLength(1);
    expect(intake.rows[0]?.provider).toBe('whatsapp');
    expect(intake.rows[0]?.payload_json).toMatchObject({
      openingMessage: opening,
      profileName: 'Walk In',
    });
    expect(intake.rows[0]?.payload_json).not.toHaveProperty('detectedLanguage');

    // The opening text is captured, never turned into qualification answers.
    expect((await db.pool.query(
      'SELECT answers_json FROM edge_conversations WHERE phone_normalized=$1', [phone],
    )).rows[0]?.answers_json).toEqual({});
  });

  it('asks Franco-Arabic openers to choose rather than guessing English', async () => {
    // "3ayez sha2a" is Latin script from an Arabic speaker. Script detection
    // used to put this lead in English; now the lead is asked.
    await seedClient();
    const phone = '+201125337757';

    await deliver({ from: phone, text: '3ayez sha2a fe el tagamo3' });

    expect((await db.pool.query(
      'SELECT preferred_language, current_stage FROM edge_conversations WHERE phone_normalized=$1', [phone],
    )).rows[0]).toEqual({ preferred_language: '', current_stage: 'language_selection' });
    expect((await outboundText(phone)).text).toContain('اختار اللغة');
  });

  it('proceeds in Arabic once the lead picks Arabic', async () => {
    await seedClient();
    const phone = '+201125337758';

    await deliver({ from: phone, text: 'السلام عليكم' });
    await deliver({ from: phone, text: 'العربية' });

    expect((await db.pool.query(
      'SELECT preferred_language, current_stage FROM edge_conversations WHERE phone_normalized=$1', [phone],
    )).rows[0]).toEqual({ preferred_language: 'Arabic', current_stage: 'awaiting_permission' });
    expect((await outboundText(phone)).text).toContain('ممكن أسألك كام سؤال سريع');
  });

  it('proceeds in English once the lead picks English', async () => {
    await seedClient();
    const phone = '+201125337759';

    await deliver({ from: phone, text: 'Hi, I want details about the compound' });
    await deliver({ from: phone, text: 'English' });

    expect((await db.pool.query(
      'SELECT preferred_language, current_stage FROM edge_conversations WHERE phone_normalized=$1', [phone],
    )).rows[0]).toEqual({ preferred_language: 'English', current_stage: 'awaiting_permission' });
    expect((await outboundText(phone)).text).toContain('May I ask you a few quick questions');
  });

  it('ignores an inbound whose phone_number_id resolves to no client', async () => {
    // Channel row present, but no app.clients row carries that record id.
    await seedClient({ clientRecordIdOnChannel: 'recUNKNOWNCLIENT' });

    expect(await deliver({ from: '+201125337760' }))
      .toEqual({ outcome: 'ignored', reason: 'inbound_lead_capture_client_not_resolved' });
    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
  });

  it('ignores an inbound on a phone_number_id with no channel row', async () => {
    await seedClient({ withChannel: false });

    expect(await deliver({ from: '+201125337761' }))
      .toEqual({ outcome: 'ignored', reason: 'channel_not_edge_enabled' });
    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('0');
  });

  it('ignores staff numbers instead of turning them into leads', async () => {
    const managerPhone = '+201000000001';
    const salespersonPhone = '+201000000002';
    const seeded = await seedClient({ managerPhone });
    await db.pool.query(
      `INSERT INTO app.salespeople (client_id, name, phone_e164, active) VALUES ($1, 'Sales One', $2, true)`,
      [seeded.clientId, salespersonPhone],
    );

    expect(await deliver({ from: salespersonPhone, text: 'done' }))
      .toEqual({ outcome: 'ignored', reason: 'inbound_lead_capture_internal_number:salesperson' });
    expect(await deliver({ from: managerPhone, text: 'status?' }))
      .toEqual({ outcome: 'ignored', reason: 'inbound_lead_capture_internal_number:manager' });

    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM app.contacts')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
  });

  it('rate limits new lead capture and creates nothing once over the cap', async () => {
    await seedClient();
    const capped = new captureModule.InboundLeadCaptureService(
      new activationModule.ConversationActivationService(),
      new runtime.AuditRepository(),
      { ...configEnv.getEnv(), INBOUND_LEAD_CAPTURE_CLIENT_LIMIT: 1 },
    );
    const processor = buildProcessor(capped);

    expect(await deliver({ from: '+201125337770', processor })).toEqual({ outcome: 'processed' });
    expect(await deliver({ from: '+201125337771', processor }))
      .toEqual({ outcome: 'ignored', reason: 'inbound_lead_capture_rate_limited:client' });

    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM app.contacts')).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      'SELECT count(*) FROM edge_conversations WHERE phone_normalized=$1', ['+201125337771'],
    )).rows[0]?.count).toBe('0');
    expect((await db.pool.query(
      `SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'`,
    )).rows[0]?.count).toBe('1');
  });

  it('allows an opted-out contact to re-engage and records that it happened', async () => {
    const seeded = await seedClient();
    const phone = '+201125337780';
    await db.pool.query(
      `INSERT INTO app.contacts (client_id, name, phone_raw, phone_e164, opted_out, opt_out_reason)
       VALUES ($1, 'Former Lead', $2, $2, true, 'lead_opted_out')`,
      [seeded.clientId, phone],
    );

    expect(await deliver({ from: phone, text: 'رجعت تاني' })).toEqual({ outcome: 'processed' });

    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT count(*) FROM audit.events WHERE event_type='contact.reengaged_after_opt_out'`,
    )).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT payload_json->>'reengagedOptedOutContact' AS flag
       FROM audit.events WHERE event_type='lead.captured_from_inbound'`,
    )).rows[0]?.flag).toBe('true');
  });

  it('leaves an existing conversation on the current path', async () => {
    const seeded = await seedClient();
    const phone = '+201125337790';
    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, name, phone_raw, phone_e164) VALUES ($1,'Known',$2,$2) RETURNING contact_id`,
      [seeded.clientId, phone],
    );
    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads (client_id, contact_id, provider, provider_external_id, source, current_stage)
       VALUES ($1,$2,'website','ext-known','website_form','asking_location') RETURNING lead_id`,
      [seeded.clientId, contact.rows[0]?.contact_id],
    );
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, preferred_language, current_stage, current_question_key, status,
         conversation_engine, state_authority, config_version, configuration_version_id)
       VALUES ($1,$2,$3,'recKNOWN',$4,'Known','Inbound Realty','English','asking_location',
               'q_location','in_qualification','edge','edge',$5,$6)`,
      [CLIENT_RECORD_ID, seeded.clientId, phone, lead.rows[0]?.lead_id, seeded.versionKey, seeded.configurationVersionId],
    );

    expect(await deliver({ from: phone, text: 'New Cairo' })).toEqual({ outcome: 'processed' });

    // Advanced through the existing flow; no capture side effects.
    expect((await db.pool.query(
      `SELECT current_stage, answers_json->>'q_location' AS location
       FROM edge_conversations WHERE phone_normalized=$1`, [phone],
    )).rows[0]).toEqual({ current_stage: 'asking_unit_type', location: 'New Cairo' });
    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM app.lead_intake_events')).rows[0]?.count).toBe('0');
    expect((await db.pool.query(
      `SELECT count(*) FROM audit.events WHERE event_type='lead.captured_from_inbound'`,
    )).rows[0]?.count).toBe('0');
  });

  it('activates a conversation for an intake lead so its first reply is processed', async () => {
    // The regression this fixes: LeadIntakeService created contact + lead but no
    // conversation, so every form and lead-ad lead was answered with
    // `conversation_not_activated` the moment it replied.
    const seeded = await seedClient();
    const phone = '+201125337800';

    const result = await new leadIntake.LeadIntakeService().intake({
      clientId: seeded.clientId,
      provider: 'website',
      providerExternalId: 'evt-intake-1',
      source: 'website_form',
      contact: { name: 'Form Lead', phoneRaw: phone },
    });
    expect(result.leadId).toBeTruthy();

    const conversation = await db.pool.query<{ lead_id: string; preferred_language: string; current_stage: string }>(
      'SELECT lead_id, preferred_language, current_stage FROM edge_conversations WHERE phone_normalized=$1',
      [phone],
    );
    expect(conversation.rows).toHaveLength(1);
    expect(conversation.rows[0]?.lead_id).toBe(result.leadId);
    // Intake leads keep the existing language-selection entry point.
    expect(conversation.rows[0]?.preferred_language).toBe('');

    expect(await deliver({ from: phone, text: 'Hello' })).toEqual({ outcome: 'processed' });
    expect((await outboundText(phone)).text).toContain('choose your preferred language');
    // The reply belongs to the intake lead; no second lead was captured.
    expect((await db.pool.query('SELECT count(*) FROM app.leads')).rows[0]?.count).toBe('1');
    expect((await db.pool.query('SELECT source FROM app.leads')).rows[0]?.source).toBe('website_form');
  });

  it('leaves the rest of intake behaviour unchanged', async () => {
    const seeded = await seedClient();
    const phone = '+201125337810';

    const result = await new leadIntake.LeadIntakeService().intake({
      clientId: seeded.clientId,
      provider: 'website',
      providerExternalId: 'evt-intake-2',
      source: 'website_form',
      contact: { name: 'Form Lead', phoneRaw: phone },
      firstContact: {
        phoneNumberId: PHONE_NUMBER_ID,
        payload: { kind: 'template', templateName: 'lead_welcome', languageCode: 'ar' },
      },
    });

    expect(result.duplicate).toBe(false);
    expect(result.firstContact?.suppressed).toBe(false);
    expect((await db.pool.query(
      `SELECT message_type FROM app.messages WHERE lead_id=$1 AND direction='outbound'`, [result.leadId],
    )).rows[0]?.message_type).toBe('template');
    expect((await db.pool.query(
      `SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'`,
    )).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT count(*) FROM audit.events WHERE event_type='lead.intake_received'`,
    )).rows[0]?.count).toBe('1');

    // Replaying the same intake stays idempotent.
    const replay = await new leadIntake.LeadIntakeService().intake({
      clientId: seeded.clientId,
      provider: 'website',
      providerExternalId: 'evt-intake-2',
      source: 'website_form',
      contact: { name: 'Form Lead', phoneRaw: phone },
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.leadId).toBe(result.leadId);
    expect((await db.pool.query('SELECT count(*) FROM edge_conversations')).rows[0]?.count).toBe('1');
  });

  it('still creates the lead when the client has no published configuration', async () => {
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ('client-noconfig', 'recNOCONFIG', 'No Config Realty') RETURNING client_id`,
    );
    const clientId = client.rows[0]?.client_id || '';

    const result = await new leadIntake.LeadIntakeService().intake({
      clientId,
      provider: 'website',
      providerExternalId: 'evt-noconfig',
      source: 'website_form',
      contact: { name: 'No Config', phoneRaw: '+201125337820' },
    });

    expect(result.leadId).toBeTruthy();
    expect((await db.pool.query('SELECT count(*) FROM edge_conversations')).rows[0]?.count).toBe('0');
    expect((await db.pool.query(
      `SELECT payload_json->>'reason' AS reason
       FROM audit.events WHERE event_type='conversation.activation_skipped'`,
    )).rows[0]?.reason).toBe('no_active_configuration_version');
  });
});
