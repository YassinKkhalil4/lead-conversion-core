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

describePg('lead control inheritance on conversation creation', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-control-test.'));
  const dataDir = join(root, 'data');
  const port = 59_100 + Math.floor(Math.random() * 800);
  const dbName = 'lead_core_control_test';
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://127.0.0.1:${port}/${dbName}`,
    EDGE_SHARED_SECRET: 'test_shared_secret_123456',
    EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
    META_APP_SECRET: 'test_meta_app_secret_123456',
    META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token_123456',
    META_APPROVED_TEMPLATE_NAMES: 'lead_welcome',
    DIRECT_META_WEBHOOK_ENABLED: 'true',
    META_STATUS_PROCESSOR_ENABLED: 'true',
    DIRECT_LEAD_INGRESS_ENABLED: 'true',
    RUNTIME_WORKER_ENABLED: 'true',
    DASHBOARD_API_ENABLED: 'true',
  };

  let db: typeof import('../src/db/pool.js');
  let processorModule: typeof import('../src/services/edge-inbound-message-processor.js');
  let leadActions: typeof import('../src/services/dashboard/lead-action-service.js');
  let dashboardTypes: typeof import('../src/services/dashboard/types.js');
  let versionedConfig: typeof import('../src/configuration/versioned-config-service.js');

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${root}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
    for (const [key, value] of Object.entries(env)) process.env[key] = value as string;

    db = await import('../src/db/pool.js');
    processorModule = await import('../src/services/edge-inbound-message-processor.js');
    leadActions = await import('../src/services/dashboard/lead-action-service.js');
    dashboardTypes = await import('../src/services/dashboard/types.js');
    versionedConfig = await import('../src/configuration/versioned-config-service.js');
  }, 60_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE
        edge_active_turns, edge_message_events, edge_conversations,
        edge_client_channels, edge_lead_controls,
        runtime.outbox_commands, runtime.inbox_events, runtime.webhook_receipts,
        runtime.scheduled_jobs, runtime.dead_letters, audit.events,
        configuration.active_versions, configuration.versions,
        app.lead_capture_attempts, app.lead_intake_events, app.messages,
        app.leads, app.salespeople, app.contacts, app.projects, app.clients
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

  const PHONE_NUMBER_ID = 'phone-number-id-control';
  const CLIENT_RECORD_ID = 'recCTRLCLIENT';
  const PHONE = '+201021988942';

  async function seedClient(): Promise<{ clientId: string; versionKey: string; configurationVersionId: string }> {
    const published = await new versionedConfig.VersionedConfigService().publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId: CLIENT_RECORD_ID,
      publishedBy: 'test-operator',
    });
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ('client-control', $1, 'Control Realty') RETURNING client_id`,
      [CLIENT_RECORD_ID],
    );
    const clientId = client.rows[0]?.client_id || '';
    await db.pool.query(
      `INSERT INTO edge_client_channels
        (phone_number_id, client_record_id, client_id, company_name, active, config_version,
         direct_send_enabled, graph_phone_number_id)
       VALUES ($1, $2, $3, 'Control Realty', true, $4, true, $1)`,
      [PHONE_NUMBER_ID, CLIENT_RECORD_ID, clientId, published.versionKey],
    );
    return { clientId, versionKey: published.versionKey, configurationVersionId: published.configurationVersionId };
  }

  /** A prior lead from another channel, so its record id differs from the captured one. */
  async function seedPriorLead(clientId: string): Promise<string> {
    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, name, phone_raw, phone_e164)
       VALUES ($1, 'Prior', $2, $2) RETURNING contact_id`,
      [clientId, PHONE],
    );
    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, legacy_airtable_id, provider, provider_external_id, source, current_stage, status)
       VALUES ($1, $2, 'recPRIORLEAD', 'website', 'prior-ext', 'website_form', 'human_takeover', 'qualified')
       RETURNING lead_id`,
      [clientId, contact.rows[0]?.contact_id],
    );
    return lead.rows[0]?.lead_id || '';
  }

  async function seedControl(fields: Record<string, string | boolean>): Promise<void> {
    const columns = Object.keys(fields);
    const placeholders = columns.map((_, index) => `$${index + 3}`);
    await db.pool.query(
      `INSERT INTO edge_lead_controls (client_record_id, phone_normalized, ${columns.join(', ')})
       VALUES ($1, $2, ${placeholders.join(', ')})`,
      [CLIENT_RECORD_ID, PHONE, ...Object.values(fields)],
    );
  }

  async function deliver(input?: { text?: string; from?: string }) {
    const metaMessageId = `wamid.${randomUUID()}`;
    return new processorModule.EdgeInboundMessageProcessor().process({
      inboxEventId: randomUUID(),
      provider: 'meta',
      eventType: 'whatsapp.message_received',
      dedupeKey: `meta:whatsapp_message:${metaMessageId}`,
      attemptCount: 1,
      payload: {
        webhookType: 'whatsapp.message_received',
        phoneNumberId: PHONE_NUMBER_ID,
        metaMessageId,
        from: input?.from ?? PHONE,
        messageType: 'text',
        messageText: input?.text ?? 'Hello',
        messageOptionId: '',
        receivedAt: new Date().toISOString(),
        profileName: 'Returning Lead',
        rawMessage: {},
      },
    });
  }

  async function conversationRow() {
    const result = await db.pool.query<{
      current_stage: string; status: string; human_takeover: boolean;
      appointment_status: string; stop_follow_up: boolean;
    }>(
      `SELECT current_stage, status, human_takeover, appointment_status, stop_follow_up
       FROM edge_conversations WHERE phone_normalized=$1`,
      [PHONE],
    );
    return result.rows[0];
  }

  async function outboundCount(): Promise<string> {
    return (await db.pool.query(
      `SELECT count(*) FROM app.messages WHERE direction='outbound' AND to_address=$1`, [PHONE],
    )).rows[0]?.count as string;
  }

  async function auditCount(eventType: string): Promise<string> {
    return (await db.pool.query(
      'SELECT count(*) FROM audit.events WHERE event_type=$1', [eventType],
    )).rows[0]?.count as string;
  }

  it('greets a contact whose prior lead was left in human_takeover', async () => {
    // Exactly the production shape: human_takeover=false while current_stage
    // still reads 'human_takeover', scoped to the earlier lead.
    const seeded = await seedClient();
    await seedPriorLead(seeded.clientId);
    await seedControl({
      lead_record_id: 'recPRIORLEAD',
      status: 'qualified',
      current_stage: 'human_takeover',
      human_takeover: false,
    });

    expect(await deliver()).toEqual({ outcome: 'processed' });

    expect(await conversationRow()).toMatchObject({
      current_stage: 'language_selection',
      human_takeover: false,
      status: '',
    });
    expect(await outboundCount()).toBe('1');
    expect(await auditCount('conversation.reply_suppressed')).toBe('0');
    expect(await auditCount('conversation.activated_suppressed')).toBe('0');
  });

  it('greets a contact whose prior lead had booked an appointment', async () => {
    const seeded = await seedClient();
    await seedPriorLead(seeded.clientId);
    await seedControl({
      lead_record_id: 'recPRIORLEAD',
      current_stage: 'appointment_booked',
      appointment_status: 'booked',
      status: 'qualified',
    });

    expect(await deliver()).toEqual({ outcome: 'processed' });

    expect(await conversationRow()).toMatchObject({
      current_stage: 'language_selection',
      appointment_status: '',
    });
    expect(await outboundCount()).toBe('1');
    expect(await auditCount('conversation.reply_suppressed')).toBe('0');
  });

  it('still honours an operator takeover pre-seeded before any conversation exists', async () => {
    // The dashboard writes no lead_record_id in this case, and that decision
    // must carry into whichever lead first messages.
    await seedClient();
    await seedControl({ human_takeover: true, current_stage: 'human_takeover', source: 'dashboard' });

    expect(await deliver()).toEqual({ outcome: 'processed' });

    expect(await conversationRow()).toMatchObject({
      current_stage: 'human_takeover',
      human_takeover: true,
    });
    expect(await outboundCount()).toBe('0');
    expect(await auditCount('conversation.activated_suppressed')).toBe('1');
    expect((await db.pool.query(
      `SELECT payload_json->>'reason' AS reason
       FROM audit.events WHERE event_type='conversation.activated_suppressed'`,
    )).rows[0]?.reason).toBe('human_takeover');
  });

  it('rewrites the control to the current lead only after the seed has been read', async () => {
    // Ordering matters: if the snapshot ran first, the row would already name
    // the new lead and the stale-inheritance guard would never see a mismatch.
    await seedClient();
    await seedControl({ human_takeover: true, current_stage: 'human_takeover', source: 'dashboard' });

    await deliver();

    const capturedLeadId = (await db.pool.query<{ lead_id: string }>(
      `SELECT lead_id FROM app.leads WHERE provider='whatsapp'`,
    )).rows[0]?.lead_id;
    const control = (await db.pool.query<{ lead_record_id: string; control_version: string }>(
      'SELECT lead_record_id, control_version FROM edge_lead_controls WHERE phone_normalized=$1', [PHONE],
    )).rows[0];

    // Seeded blank, inherited, then rewritten to the lead that just messaged.
    expect(control?.lead_record_id).toBe(capturedLeadId);
    expect(Number(control?.control_version)).toBeGreaterThan(0);
    expect((await conversationRow())?.human_takeover).toBe(true);
  });

  it('lets an operator release a takeover and reply again', async () => {
    const seeded = await seedClient();
    const priorLeadId = await seedPriorLead(seeded.clientId);
    await seedControl({
      lead_record_id: 'recPRIORLEAD',
      human_takeover: true,
      current_stage: 'human_takeover',
      source: 'dashboard',
    });
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, preferred_language, current_stage, current_question_key, status,
         human_takeover, conversation_engine, state_authority, config_version, configuration_version_id)
       VALUES ($1,$2,$3,'recPRIORLEAD',$4,'Prior','Control Realty','English','human_takeover',
               '', 'in_qualification', true, 'edge','edge',$5,$6)`,
      [CLIENT_RECORD_ID, seeded.clientId, PHONE, priorLeadId, seeded.versionKey, seeded.configurationVersionId],
    );

    const user = {
      userId: randomUUID(), clientId: seeded.clientId, salespersonId: null,
      email: 'ops@example.com', name: 'Ops', role: 'admin' as const,
      clientKey: 'client-control', companyName: 'Control Realty',
      timezone: 'Africa/Cairo', lastLoginAt: null,
    };
    await new leadActions.DashboardLeadActionService().takeover(
      user, dashboardTypes.scopeFor(user), priorLeadId, false,
    );

    expect((await db.pool.query<{ current_stage: string; human_takeover: boolean }>(
      'SELECT current_stage, human_takeover FROM edge_lead_controls WHERE phone_normalized=$1', [PHONE],
    )).rows[0]).toEqual({ current_stage: '', human_takeover: false });
    expect(await conversationRow()).toMatchObject({ current_stage: '', human_takeover: false });

    // The released conversation answers again instead of staying silent.
    expect(await deliver({ text: 'still there?' })).toEqual({ outcome: 'processed' });
    expect(await outboundCount()).toBe('1');
    expect(await auditCount('conversation.reply_suppressed')).toBe('0');
  });

  it('does not reset an in-flight conversation when a stale control exists', async () => {
    const seeded = await seedClient();
    const priorLeadId = await seedPriorLead(seeded.clientId);
    await seedControl({ lead_record_id: 'recSOMEOTHERLEAD', current_stage: 'human_takeover' });
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, preferred_language, current_stage, current_question_key, status,
         conversation_engine, state_authority, config_version, configuration_version_id)
       VALUES ($1,$2,$3,'recPRIORLEAD',$4,'Prior','Control Realty','English','asking_location',
               'q_location','in_qualification','edge','edge',$5,$6)`,
      [CLIENT_RECORD_ID, seeded.clientId, PHONE, priorLeadId, seeded.versionKey, seeded.configurationVersionId],
    );

    // The inbound path reads the conversation directly and never consults the
    // control overlay, so the turn advances normally and nothing is re-created.
    expect(await deliver({ text: 'New Cairo' })).toEqual({ outcome: 'processed' });
    expect((await db.pool.query(
      `SELECT count(*) FROM app.leads WHERE provider='whatsapp'`,
    )).rows[0]?.count).toBe('0');
    expect((await db.pool.query(
      `SELECT current_stage, answers_json->>'q_location' AS location
       FROM edge_conversations WHERE phone_normalized=$1`, [PHONE],
    )).rows[0]).toEqual({ current_stage: 'asking_unit_type', location: 'New Cairo' });
    expect(await auditCount('conversation.activated')).toBe('0');
  });

  it('is unchanged for a contact with no control history', async () => {
    await seedClient();

    expect(await deliver()).toEqual({ outcome: 'processed' });

    expect(await conversationRow()).toMatchObject({
      current_stage: 'language_selection',
      human_takeover: false,
      stop_follow_up: false,
    });
    expect(await outboundCount()).toBe('1');
    expect(await auditCount('conversation.activated_suppressed')).toBe('0');
  });
});
