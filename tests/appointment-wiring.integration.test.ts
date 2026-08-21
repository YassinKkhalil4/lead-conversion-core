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

describePg('appointment slot offer and booking wiring', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-appointment-test.'));
  const dataDir = join(root, 'data');
  const port = 57_500 + Math.floor(Math.random() * 900);
  const dbName = 'lead_core_appointment_test';
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
    RUNTIME_WORKER_ENABLED: 'true',
  };

  let db: typeof import('../src/db/pool.js');
  let runtime: typeof import('../src/infrastructure/runtime.js');
  let processorModule: typeof import('../src/services/edge-inbound-message-processor.js');
  let appointmentService: typeof import('../src/services/appointment-service.js');
  let appointmentConversation: typeof import('../src/services/appointment-conversation-service.js');
  let configRepository: typeof import('../src/repositories/config-repository.js');
  let conversationRepository: typeof import('../src/repositories/conversation-repository.js');
  let leadScoring: typeof import('../src/services/lead-scoring-service.js');
  let leadRouting: typeof import('../src/services/lead-routing-service.js');
  let followupScheduler: typeof import('../src/services/followup-scheduler-service.js');
  let slaService: typeof import('../src/services/sla-service.js');
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
    appointmentService = await import('../src/services/appointment-service.js');
    appointmentConversation = await import('../src/services/appointment-conversation-service.js');
    configRepository = await import('../src/repositories/config-repository.js');
    conversationRepository = await import('../src/repositories/conversation-repository.js');
    leadScoring = await import('../src/services/lead-scoring-service.js');
    leadRouting = await import('../src/services/lead-routing-service.js');
    followupScheduler = await import('../src/services/followup-scheduler-service.js');
    slaService = await import('../src/services/sla-service.js');
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
        app.appointments, app.appointment_slots, app.appointment_offers,
        app.notifications, app.messages, app.leads, app.salespeople,
        app.contacts, app.projects, app.clients
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

  const ANSWERED = {
    q_location: 'New Cairo',
    q_unit_type: 'Apartment',
    q_budget_min: '3000000',
    q_budget_max: '5000000',
    q_payment_plan: 'Cash',
    q_timeline: '3 months',
    q_purpose: 'Primary Residence',
  };

  interface Seeded {
    clientId: string;
    contactId: string;
    leadId: string;
    salespersonId: string;
    phone: string;
    phoneNumberId: string;
    clientRecordId: string;
  }

  async function seed(input: {
    suffix: string;
    phone: string;
    language?: 'English' | 'Arabic';
    currentStage?: string;
    currentQuestionKey?: string;
    stopFollowUpOnLead?: boolean;
  }): Promise<Seeded> {
    const clientRecordId = `recAPPT${input.suffix}`;
    const phoneNumberId = `phone-number-id-appt-${input.suffix.toLocaleLowerCase()}`;
    const published = await new versionedConfig.VersionedConfigService().publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId,
      publishedBy: 'test-operator',
    });
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name)
       VALUES ($1, $2, $3) RETURNING client_id`,
      [`client-appt-${input.suffix.toLocaleLowerCase()}`, clientRecordId, `Appt ${input.suffix}`],
    );
    const clientId = client.rows[0]?.client_id || '';
    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, name, phone_raw, phone_e164, consent_status)
       VALUES ($1, 'Appt Lead', $2, $2, 'opted_in') RETURNING contact_id`,
      [clientId, input.phone],
    );
    const contactId = contact.rows[0]?.contact_id || '';
    const project = await db.pool.query<{ project_id: string }>(
      `INSERT INTO app.projects (client_id, project_name) VALUES ($1, $2) RETURNING project_id`,
      [clientId, `Appt ${input.suffix} Project`],
    );
    const projectId = project.rows[0]?.project_id || '';
    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, project_id, provider, provider_external_id, source,
         source_payload_hash, current_stage, stop_follow_up)
       VALUES ($1,$2,$3,'airtable',$4,'airtable_import',$5,'asking_site_visit',$6)
       RETURNING lead_id`,
      [clientId, contactId, projectId, `ext-${input.suffix}`, `hash-${input.suffix}`, input.stopFollowUpOnLead ?? false],
    );
    const leadId = lead.rows[0]?.lead_id || '';
    const salesperson = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople (client_id, name, phone_e164, active, priority_rank)
       VALUES ($1, $2, $3, true, 10) RETURNING salesperson_id`,
      [clientId, `${input.suffix} Sales`, `+2010777${input.suffix.slice(0, 4).padEnd(4, '0')}`],
    );
    const salespersonId = salesperson.rows[0]?.salesperson_id || '';
    // Routing only considers salespeople attached to the lead's project.
    await db.pool.query(
      'INSERT INTO app.salesperson_projects (salesperson_id, project_id) VALUES ($1, $2)',
      [salespersonId, projectId],
    );
    await db.pool.query(
      `INSERT INTO edge_client_channels
        (phone_number_id, client_record_id, client_id, company_name, active, config_version,
         direct_send_enabled, graph_phone_number_id)
       VALUES ($1,$2,$3,$4,true,$5,true,$1)`,
      [phoneNumberId, clientRecordId, clientId, `Appt ${input.suffix}`, published.versionKey],
    );
    await db.pool.query(
      `INSERT INTO edge_conversations
        (client_record_id, client_id, phone_normalized, lead_record_id, lead_id, lead_name,
         company_name, project_name, project_record_id, preferred_language, current_stage,
         current_question_key, answers_json, status, conversation_engine, state_authority,
         config_version, configuration_version_id)
       VALUES ($1,$2,$3,$4,$5,'Appt Lead',$6,$7,$8,$9,$10,$11,$12::jsonb,'in_qualification',
               'edge','edge',$13,$14)`,
      [
        clientRecordId, clientId, input.phone, `rec${input.suffix}LEAD`, leadId,
        `Appt ${input.suffix}`, `Appt ${input.suffix} Project`, `rec${input.suffix}PROJECT`,
        input.language ?? 'English',
        input.currentStage ?? 'asking_site_visit',
        input.currentQuestionKey ?? 'q_site_visit',
        JSON.stringify(ANSWERED),
        published.versionKey, published.configurationVersionId,
      ],
    );
    return { clientId, contactId, leadId, salespersonId, phone: input.phone, phoneNumberId, clientRecordId };
  }

  function buildProcessor(overrides?: { appointments?: InstanceType<typeof appointmentConversation.AppointmentConversationService> }) {
    return new processorModule.EdgeInboundMessageProcessor(
      new configRepository.ConfigRepository(),
      new conversationRepository.ConversationRepository(),
      new runtime.RuntimeOutboxRepository(),
      new runtime.AuditRepository(),
      new leadScoring.LeadScoringService(),
      new leadRouting.LeadRoutingService(),
      new followupScheduler.FollowupSchedulerService(),
      new slaService.SlaService(),
      overrides?.appointments ?? new appointmentConversation.AppointmentConversationService(),
    );
  }

  async function deliver(input: {
    seeded: Seeded;
    metaMessageId: string;
    text?: string;
    optionId?: string;
    receivedAt?: string;
    processor?: ReturnType<typeof buildProcessor>;
  }) {
    const processor = input.processor ?? buildProcessor();
    return processor.process({
      inboxEventId: randomUUID(),
      provider: 'meta',
      eventType: 'whatsapp.message_received',
      dedupeKey: `meta:whatsapp_message:${input.metaMessageId}`,
      attemptCount: 1,
      payload: {
        webhookType: 'whatsapp.message_received',
        phoneNumberId: input.seeded.phoneNumberId,
        metaMessageId: input.metaMessageId,
        from: input.seeded.phone,
        messageType: input.optionId ? 'interactive' : 'text',
        messageText: input.text ?? '',
        messageOptionId: input.optionId ?? '',
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        profileName: 'Appt Lead',
        rawMessage: {},
      },
    });
  }

  async function offeredSlots(leadId: string): Promise<Array<{ optionId: string; startsAt: string }>> {
    const rows = await db.pool.query<{ appointment_offer_id: string; appointment_slot_id: string; starts_at: Date }>(
      `SELECT s.appointment_offer_id, s.appointment_slot_id, s.starts_at
       FROM app.appointment_slots s
       JOIN app.appointment_offers o USING (appointment_offer_id)
       WHERE o.lead_id=$1 AND s.status='offered'
       ORDER BY s.starts_at`,
      [leadId],
    );
    return rows.rows.map((row) => ({
      optionId: `appt:${row.appointment_offer_id}:${row.appointment_slot_id}`,
      startsAt: row.starts_at.toISOString(),
    }));
  }

  async function queuedListMessage(leadId: string) {
    const result = await db.pool.query<{ raw_payload: { message?: { kind?: string; text?: string; options?: Array<{ id: string; title: string }> } } }>(
      `SELECT raw_payload FROM app.messages
       WHERE lead_id=$1 AND direction='outbound' AND message_type='list'
       ORDER BY created_at DESC LIMIT 1`,
      [leadId],
    );
    return result.rows[0]?.raw_payload.message;
  }

  it('offers slots as an interactive list when the lead accepts a site visit', async () => {
    const seeded = await seed({ suffix: 'OFFER', phone: '+201099000001' });

    expect(await deliver({ seeded, metaMessageId: 'wamid.offer.1', text: 'Yes, please' }))
      .toEqual({ outcome: 'processed' });

    expect((await db.pool.query(
      `SELECT current_stage, current_question_key, status FROM edge_conversations WHERE lead_id=$1`,
      [seeded.leadId],
    )).rows[0]).toEqual({
      current_stage: 'awaiting_appointment_slot',
      current_question_key: '',
      status: 'qualified',
    });

    const message = await queuedListMessage(seeded.leadId);
    expect(message?.kind).toBe('list');
    expect(message?.options).toHaveLength(9);
    for (const option of message?.options || []) {
      expect(option.id).toMatch(/^appt:[0-9a-f-]{36}:[0-9a-f-]{36}$/);
      expect(option.title.length).toBeLessThanOrEqual(24);
    }

    expect((await db.pool.query('SELECT count(*) FROM app.appointment_offers WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT count(*) FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'`,
    )).rows[0]?.count).toBe('1');
    // Qualification still completed, so scoring and routing ran.
    expect((await db.pool.query('SELECT status FROM app.leads WHERE lead_id=$1', [seeded.leadId])).rows[0]?.status).toBe('qualified');
  });

  it('renders Arabic row titles inside the Meta 24-character cap', async () => {
    const seeded = await seed({ suffix: 'ARABIC', phone: '+201099000002', language: 'Arabic' });

    await deliver({ seeded, metaMessageId: 'wamid.arabic.1', text: 'أيوه، يا ريت' });

    const message = await queuedListMessage(seeded.leadId);
    const titles = (message?.options || []).map((option) => option.title);
    expect(titles).toHaveLength(9);
    for (const title of titles) {
      expect(title).toMatch(/^(الأحد|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت) \d{1,2} \S+ \d{2}:\d{2}$/u);
      expect(title.length).toBeLessThanOrEqual(24);
    }
    expect(message?.text).toContain('اختار الميعاد');
  });

  it('falls through to the closing message when the 24-hour window is closed', async () => {
    const seeded = await seed({ suffix: 'WINDOW', phone: '+201099000003' });
    const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    await deliver({ seeded, metaMessageId: 'wamid.window.1', text: 'Yes, please', receivedAt: stale });

    expect((await db.pool.query('SELECT current_stage FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0]?.current_stage)
      .toBe('qualified');
    expect((await db.pool.query('SELECT count(*) FROM app.appointment_offers')).rows[0]?.count).toBe('0');
    expect((await db.pool.query(
      `SELECT payload_json->>'reason' AS reason FROM audit.events WHERE event_type='appointment.offer_skipped'`,
    )).rows[0]?.reason).toBe('conversation_window_closed');
    // The lead still gets the ordinary closing text, never a template.
    expect((await db.pool.query(
      `SELECT message_type FROM app.messages WHERE lead_id=$1 AND direction='outbound'`,
      [seeded.leadId],
    )).rows[0]?.message_type).toBe('text');
  });

  it('falls through when the lead is stopped, instead of sending an empty list', async () => {
    // `AppointmentService.createOffer` returns an empty offer id rather than
    // throwing when app.leads.stop_follow_up is set.
    const seeded = await seed({ suffix: 'STOPPED', phone: '+201099000004', stopFollowUpOnLead: true });

    await deliver({ seeded, metaMessageId: 'wamid.stopped.1', text: 'Yes, please' });

    expect((await db.pool.query('SELECT current_stage FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0]?.current_stage)
      .toBe('qualified');
    expect((await db.pool.query('SELECT count(*) FROM app.appointment_offers')).rows[0]?.count).toBe('0');
    expect((await db.pool.query(
      `SELECT payload_json->>'reason' AS reason FROM audit.events WHERE event_type='appointment.offer_skipped'`,
    )).rows[0]?.reason).toBe('lead_not_eligible_for_offer');
    expect(await queuedListMessage(seeded.leadId)).toBeUndefined();
  });

  it('books a tapped slot, notifies the salesperson, and confirms to the lead', async () => {
    const seeded = await seed({ suffix: 'BOOK', phone: '+201099000005' });
    await deliver({ seeded, metaMessageId: 'wamid.book.1', text: 'Yes, please' });
    const slots = await offeredSlots(seeded.leadId);
    expect(slots.length).toBe(9);

    expect(await deliver({ seeded, metaMessageId: 'wamid.book.2', optionId: slots[0]?.optionId || '' }))
      .toEqual({ outcome: 'processed' });

    const appointment = await db.pool.query<{ status: string; starts_at: Date }>(
      'SELECT status, starts_at FROM app.appointments WHERE lead_id=$1',
      [seeded.leadId],
    );
    expect(appointment.rows).toHaveLength(1);
    expect(appointment.rows[0]?.status).toBe('booked');
    expect(appointment.rows[0]?.starts_at.toISOString()).toBe(slots[0]?.startsAt);

    expect((await db.pool.query('SELECT current_stage, appointment_status FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0])
      .toEqual({ current_stage: 'appointment_booked', appointment_status: 'booked' });

    const commands = await db.pool.query<{ command_type: string; idempotency_key: string }>(
      'SELECT command_type, idempotency_key FROM runtime.outbox_commands ORDER BY created_at',
    );
    const types = commands.rows.map((row) => row.command_type);
    expect(types).toContain('salesperson.appointment_booked_notification');
    expect(types.filter((type) => type === 'whatsapp.send_message')).toHaveLength(2);

    const appointmentId = (await db.pool.query<{ appointment_id: string }>(
      'SELECT appointment_id FROM app.appointments WHERE lead_id=$1', [seeded.leadId],
    )).rows[0]?.appointment_id;
    expect(commands.rows.some((row) => row.idempotency_key === `salesperson.appointment_booked:${appointmentId}`)).toBe(true);
    expect(commands.rows.some((row) => row.idempotency_key.includes(`appointment_booked:${appointmentId}`))).toBe(true);
  });

  it('enqueues no calendar command when the client calendar id is empty', async () => {
    const seeded = await seed({ suffix: 'NOCAL', phone: '+201099000006' });
    expect((await db.pool.query('SELECT calendar_id FROM app.clients WHERE client_id=$1', [seeded.clientId])).rows[0]?.calendar_id).toBe('');

    await deliver({ seeded, metaMessageId: 'wamid.nocal.1', text: 'Yes, please' });
    const slots = await offeredSlots(seeded.leadId);
    await deliver({ seeded, metaMessageId: 'wamid.nocal.2', optionId: slots[0]?.optionId || '' });

    expect((await db.pool.query(
      `SELECT count(*) FROM runtime.outbox_commands WHERE command_type='calendar.create_event'`,
    )).rows[0]?.count).toBe('0');
    // The booking itself still completes and still confirms to the lead.
    expect((await db.pool.query('SELECT status, outbox_command_id FROM app.appointments WHERE lead_id=$1', [seeded.leadId])).rows[0])
      .toEqual({ status: 'booked', outbox_command_id: null });
    expect((await db.pool.query('SELECT count(*) FROM runtime.dead_letters')).rows[0]?.count).toBe('0');
  });

  it('creates exactly one appointment when the same lead taps the same slot twice', async () => {
    // One lead, two taps. This does not exercise two different leads competing
    // for one wall-clock time: slots are per-offer, so no such contention exists.
    const seeded = await seed({ suffix: 'DOUBLE', phone: '+201099000007' });
    await deliver({ seeded, metaMessageId: 'wamid.double.1', text: 'Yes, please' });
    const slots = await offeredSlots(seeded.leadId);
    const optionId = slots[0]?.optionId || '';

    await deliver({ seeded, metaMessageId: 'wamid.double.2', optionId });
    await deliver({ seeded, metaMessageId: 'wamid.double.3', optionId });

    expect((await db.pool.query('SELECT count(*) FROM app.appointments WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT count(*) FROM runtime.outbox_commands WHERE command_type='salesperson.appointment_booked_notification'`,
    )).rows[0]?.count).toBe('1');
    expect((await db.pool.query(
      `SELECT count(*) FROM app.messages WHERE lead_id=$1 AND direction='outbound' AND message_type='text'`,
      [seeded.leadId],
    )).rows[0]?.count).toBe('1');
  });

  it('re-offers when the tapped slot is no longer available', async () => {
    const seeded = await seed({ suffix: 'TAKEN', phone: '+201099000008' });
    await deliver({ seeded, metaMessageId: 'wamid.taken.1', text: 'Yes, please' });
    const slots = await offeredSlots(seeded.leadId);
    const [offerId, slotId] = (slots[0]?.optionId || '').replace('appt:', '').split(':');

    // Book the slot out of band so the tap arrives at an already-booked slot
    // while the conversation is still parked on the slot stage.
    await new appointmentService.AppointmentService().bookSlot({
      appointmentOfferId: offerId || '',
      appointmentSlotId: slotId || '',
      sourceEventId: 'out-of-band-booking',
      bookedBy: seeded.leadId,
    });

    await deliver({ seeded, metaMessageId: 'wamid.taken.2', optionId: slots[0]?.optionId || '' });

    expect((await db.pool.query('SELECT count(*) FROM app.appointment_offers WHERE lead_id=$1', [seeded.leadId])).rows[0]?.count).toBe('2');
    expect((await db.pool.query('SELECT current_stage FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0]?.current_stage)
      .toBe('awaiting_appointment_slot');
    const message = await queuedListMessage(seeded.leadId);
    expect(message?.text).toContain('just been taken');
    // The instant already booked is not offered a second time.
    const reoffered = (message?.options || []).map((option) => option.id);
    expect(reoffered).not.toContain(slots[0]?.optionId);
  });

  it('re-prompts an unreadable slot reply once and then closes', async () => {
    const seeded = await seed({ suffix: 'GARBAGE', phone: '+201099000009' });
    await deliver({ seeded, metaMessageId: 'wamid.garbage.1', text: 'Yes, please' });

    await deliver({ seeded, metaMessageId: 'wamid.garbage.2', text: 'whenever you like' });
    expect((await db.pool.query('SELECT current_stage, retry_count FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0])
      .toEqual({ current_stage: 'awaiting_appointment_slot', retry_count: 1 });

    await deliver({ seeded, metaMessageId: 'wamid.garbage.3', text: 'still not a slot' });
    expect((await db.pool.query('SELECT current_stage FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0]?.current_stage)
      .toBe('qualified');
    expect((await db.pool.query(
      `SELECT count(*) FROM app.messages WHERE lead_id=$1 AND direction='outbound'`,
      [seeded.leadId],
    )).rows[0]?.count).toBe('3');
  });

  it('rolls the offer back with the turn when the transaction fails', async () => {
    const seeded = await seed({ suffix: 'ATOMIC', phone: '+201099000010' });
    const failingAudit = {
      record: async (): Promise<string> => { throw new Error('audit_failure_probe'); },
    } as unknown as InstanceType<typeof runtime.AuditRepository>;
    const processor = buildProcessor({
      appointments: new appointmentConversation.AppointmentConversationService(
        new appointmentService.AppointmentService(),
        new runtime.RuntimeOutboxRepository(),
        failingAudit,
      ),
    });

    await expect(deliver({ seeded, metaMessageId: 'wamid.atomic.1', text: 'Yes, please', processor }))
      .rejects.toThrow('audit_failure_probe');

    // The offer, its slots, the outbound message and the outbox command are all
    // written on the caller's transaction, so none of them survive the failure.
    expect((await db.pool.query('SELECT count(*) FROM app.appointment_offers')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM app.appointment_slots')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM runtime.outbox_commands')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT count(*) FROM app.messages')).rows[0]?.count).toBe('0');
    expect((await db.pool.query('SELECT current_stage FROM edge_conversations WHERE lead_id=$1', [seeded.leadId])).rows[0]?.current_stage)
      .toBe('asking_site_visit');
  });
});
