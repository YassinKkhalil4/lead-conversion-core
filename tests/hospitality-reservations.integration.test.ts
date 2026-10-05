import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describePostgres } from './helpers/postgres.js';

const describePg = describePostgres(['initdb', 'pg_ctl', 'createdb', 'psql']);

describePg('hospitality reservations over WhatsApp, with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-hospitality-test.'));
  const dataDir = join(root, 'data');
  const port = 58_300 + Math.floor(Math.random() * 900);
  const dbName = 'lead_core_hospitality_test';
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
  let processorModule: typeof import('../src/services/edge-inbound-message-processor.js');
  let versionedConfig: typeof import('../src/configuration/versioned-config-service.js');
  let floorPlan: typeof import('../src/integrations/reservations/kadensio-floor-plan.js');

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${root}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
    for (const [key, value] of Object.entries(env)) process.env[key] = value as string;

    db = await import('../src/db/pool.js');
    processorModule = await import('../src/services/edge-inbound-message-processor.js');
    versionedConfig = await import('../src/configuration/versioned-config-service.js');
    floorPlan = await import('../src/integrations/reservations/kadensio-floor-plan.js');
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

  const PHONE_NUMBER_ID = 'phone-number-id-venue';
  const CLIENT_RECORD_ID = 'recVENUECLIENT';

  interface Venue {
    clientId: string;
    projectId: string;
    hostId: string;
    interiorId: string;
    terraceId: string;
    lunchId: string;
    dinnerId: string;
  }

  async function seedVenue(input: { threshold?: number | null; terraceCovers?: number; dinnerDays?: number[] } = {}): Promise<Venue> {
    const published = await new versionedConfig.VersionedConfigService().publish({
      sourcePath: join(process.cwd(), 'config/seed-hospitality.json'),
      clientRecordId: CLIENT_RECORD_ID,
      publishedBy: 'test-operator',
    });
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name, timezone, vertical, deposit_threshold_party_size)
       VALUES ('cal-demo', $1, 'Cal Demo', 'Europe/Madrid', 'hospitality', $2) RETURNING client_id`,
      [CLIENT_RECORD_ID, input.threshold === undefined ? 8 : input.threshold],
    );
    const clientId = client.rows[0]!.client_id;
    await db.pool.query(
      `INSERT INTO edge_client_channels
        (phone_number_id, client_record_id, client_id, company_name, active, config_version, direct_send_enabled, graph_phone_number_id)
       VALUES ($1, $2, '', 'Cal Demo', true, $3, true, $1)`,
      [PHONE_NUMBER_ID, CLIENT_RECORD_ID, published.versionKey],
    );
    const project = await db.pool.query<{ project_id: string }>(
      `INSERT INTO app.projects (client_id, project_name, maps_url) VALUES ($1, 'Cal Demo Gràcia', 'https://maps.example/cal-demo') RETURNING project_id`,
      [clientId],
    );
    const projectId = project.rows[0]!.project_id;
    const host = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople (client_id, name, phone_e164) VALUES ($1, 'Host Laia', '+34611111111') RETURNING salesperson_id`,
      [clientId],
    );
    const hostId = host.rows[0]!.salesperson_id;
    await db.pool.query('INSERT INTO app.salesperson_projects (salesperson_id, project_id) VALUES ($1, $2)', [hostId, projectId]);

    const zone = async (key: string, es: string) =>
      (await db.pool.query<{ zone_id: string }>(
        `INSERT INTO app.venue_zones (client_id, project_id, zone_key, labels) VALUES ($1, $2, $3, $4::jsonb) RETURNING zone_id`,
        [clientId, projectId, key, JSON.stringify({ English: key, Spanish: es })],
      )).rows[0]!.zone_id;
    const shift = async (key: string, start: string, last: string, days: number[]) =>
      (await db.pool.query<{ shift_id: string }>(
        `INSERT INTO app.venue_shifts (client_id, project_id, shift_key, labels, starts_at_local, last_seating_local, days_open)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::smallint[]) RETURNING shift_id`,
        [clientId, projectId, key, JSON.stringify({ English: key, Spanish: key === 'lunch' ? 'comida' : 'cena', Catalan: key === 'lunch' ? 'dinar' : 'sopar' }), start, last, days],
      )).rows[0]!.shift_id;
    const interiorId = await zone('interior', 'Sala interior');
    const terraceId = await zone('terrace', 'Terraza');
    const lunchId = await shift('lunch', '13:30', '15:30', [1, 2, 3, 4, 5, 6, 7]);
    const dinnerId = await shift('dinner', '20:30', '22:30', input.dinnerDays ?? [1, 2, 3, 4, 5, 6, 7]);
    for (const [z, s, covers] of [
      [interiorId, lunchId, 20], [interiorId, dinnerId, 20], [terraceId, lunchId, 8], [terraceId, dinnerId, input.terraceCovers ?? 8],
    ] as const) {
      await db.pool.query('INSERT INTO app.venue_capacity (zone_id, shift_id, covers) VALUES ($1, $2, $3)', [z, s, covers]);
    }
    return { clientId, projectId, hostId, interiorId, terraceId, lunchId, dinnerId };
  }

  async function deliver(from: string, input: { text?: string; option?: string; metaMessageId?: string }) {
    const metaMessageId = input.metaMessageId ?? `wamid.${randomUUID()}`;
    return new processorModule.EdgeInboundMessageProcessor().process({
      inboxEventId: randomUUID(),
      workerId: 'test-worker',
      provider: 'meta',
      eventType: 'whatsapp.message_received',
      dedupeKey: `meta:whatsapp_message:${metaMessageId}`,
      attemptCount: 1,
      payload: {
        webhookType: 'whatsapp.message_received',
        phoneNumberId: PHONE_NUMBER_ID,
        metaMessageId,
        from,
        messageType: input.option ? 'interactive' : 'text',
        messageText: input.text ?? '',
        messageOptionId: input.option ?? '',
        receivedAt: new Date().toISOString(),
        profileName: 'Marta',
        rawMessage: {},
      },
    });
  }

  async function lastReply(phone: string): Promise<string> {
    const result = await db.pool.query<{ message_text: string }>(
      `SELECT message_text FROM app.messages WHERE direction='outbound' AND to_address=$1 ORDER BY created_at DESC, message_id DESC LIMIT 1`,
      [phone],
    );
    return result.rows[0]?.message_text || '';
  }

  /** A guest runs the whole conversation; returns the final reply. */
  async function book(phone: string, answers: { language?: string; party: string; when: string; zone: string }): Promise<string> {
    await deliver(phone, { text: 'hola' });
    await deliver(phone, { option: answers.language ?? 'lang_es' });
    await deliver(phone, { option: 'perm_yes' });
    await deliver(phone, { text: answers.party });
    await deliver(phone, { text: answers.when });
    await deliver(phone, { option: answers.zone });
    return lastReply(phone);
  }

  it('books a table in Spanish: reservation, host assignment, notification, no score', async () => {
    const venue = await seedVenue();
    const reply = await book('+34600000001', { party: 'somos 4', when: 'el viernes cena', zone: 'zone_terrace' });
    expect(reply).toContain('Reservado ✅ 4 personas');
    expect(reply).toContain('Terraza');
    expect(reply).toContain('https://maps.example/cal-demo');

    const rows = await db.pool.query<Record<string, unknown>>(
      'SELECT party_size, status, deposit_required, provider, project_id, zone_id, shift_id, to_char(service_date, \'YYYY-MM-DD\') AS d, starts_at FROM app.reservations',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ party_size: 4, status: 'confirmed', deposit_required: false, provider: 'kadensio', project_id: venue.projectId, zone_id: venue.terraceId, shift_id: venue.dinnerId });
    // 20:30 local in Madrid, whichever side of daylight saving the date falls on.
    const startsAt = (rows.rows[0]!.starts_at as Date).toISOString();
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(startsAt));
    expect(local).toBe('20:30');

    const lead = await db.pool.query<{ pipeline_stage: string; status: string }>('SELECT pipeline_stage, status FROM app.leads');
    expect(lead.rows[0]).toMatchObject({ pipeline_stage: 'site_visit_scheduled', status: 'qualified' });
    const assigned = await db.pool.query('SELECT salesperson_id FROM app.lead_assignments WHERE status=\'assigned\'');
    expect(assigned.rows[0]?.salesperson_id).toBe(venue.hostId);
    const notified = await db.pool.query(`SELECT payload_json FROM runtime.outbox_commands WHERE command_type='salesperson.lead_assignment_notification'`);
    expect(notified.rows).toHaveLength(1);
    expect((await db.pool.query('SELECT count(*) FROM app.score_runs')).rows[0]?.count).toBe('0');
  });

  it('books in Catalan', async () => {
    await seedVenue();
    const reply = await book('+34600000002', { language: 'lang_ca', party: 'dues persones', when: 'demà dinar', zone: 'zone_interior' });
    expect(reply).toContain('Reservat ✅ 2 persones');
  });

  it('holds a large group for the venue instead of confirming it', async () => {
    await seedVenue({ threshold: 8 });
    const reply = await book('+34600000003', { party: '9', when: 'el sábado cena', zone: 'zone_interior' });
    expect(reply).toContain('el local confirma personalmente');
    const row = await db.pool.query('SELECT status, deposit_required, deposit_status, confirmed_at FROM app.reservations');
    expect(row.rows[0]).toMatchObject({ status: 'requested', deposit_required: true, deposit_status: 'pending', confirmed_at: null });
    const lead = await db.pool.query('SELECT pipeline_stage FROM app.leads');
    expect(lead.rows[0]?.pipeline_stage).toBe('in_progress');
  });

  it('never sells the last table twice, and asks the second guest for another day', async () => {
    await seedVenue({ terraceCovers: 8 });
    expect(await book('+34600000004', { party: '6', when: 'el viernes cena', zone: 'zone_terrace' })).toContain('Reservado ✅');
    const reply = await book('+34600000005', { party: '6', when: 'el viernes cena', zone: 'zone_terrace' });
    expect(reply).toContain('no tenemos mesa para 6');
    expect((await db.pool.query('SELECT count(*) FROM app.reservations')).rows[0]?.count).toBe('1');
    // The conversation is back on the date question, party size kept.
    const state = await db.pool.query<{ current_stage: string; state_json: { answers: Record<string, string> } }>(
      `SELECT c.current_stage, c.state_json FROM app.conversations c JOIN app.contacts ct USING (contact_id) WHERE ct.phone_e164='+34600000005'`,
    );
    expect(state.rows[0]?.current_stage).toBe('asking_date_shift');
    expect(state.rows[0]?.state_json.answers).toMatchObject({ q_party_size: '6' });
    expect(state.rows[0]?.state_json.answers.q_zone).toBeUndefined();
  });

  it('lets exactly one of two simultaneous bookings take the last covers', async () => {
    const venue = await seedVenue({ terraceCovers: 8 });
    const provider = new floorPlan.KadensioFloorPlanProvider();
    const guests = await Promise.all([1, 2].map(async (n) => {
      const contact = await db.pool.query<{ contact_id: string }>(
        `INSERT INTO app.contacts (client_id, phone_e164) VALUES ($1, $2) RETURNING contact_id`, [venue.clientId, `+3460000010${n}`]);
      const lead = await db.pool.query<{ lead_id: string }>(
        `INSERT INTO app.leads (client_id, contact_id, provider, provider_external_id) VALUES ($1, $2, 'whatsapp', $3) RETURNING lead_id`,
        [venue.clientId, contact.rows[0]!.contact_id, `+3460000010${n}`]);
      return { contactId: contact.rows[0]!.contact_id, leadId: lead.rows[0]!.lead_id, n };
    }));
    const results = await Promise.all(guests.map(async (g) => {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await provider.book(client, {
          clientId: venue.clientId, projectId: venue.projectId, contactId: g.contactId, leadId: g.leadId, conversationId: null,
          zoneId: venue.terraceId, shiftId: venue.dinnerId, serviceDate: '2030-06-14', timezone: 'Europe/Madrid',
          partySize: 5, depositThreshold: null, language: 'Spanish', channel: 'whatsapp', notes: '', idempotencyKey: `race-${g.n}`,
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }));
    expect(results.filter((r) => r.outcome === 'booked')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'unavailable')).toHaveLength(1);
    expect((await db.pool.query('SELECT sum(party_size)::int AS covers FROM app.reservations')).rows[0]?.covers).toBe(5);
  });

  it('books once when the same turn is delivered twice', async () => {
    await seedVenue();
    const phone = '+34600000006';
    await deliver(phone, { text: 'hola' });
    await deliver(phone, { option: 'lang_es' });
    await deliver(phone, { option: 'perm_yes' });
    await deliver(phone, { text: '2' });
    await deliver(phone, { text: 'el viernes comida' });
    await deliver(phone, { option: 'zone_interior', metaMessageId: 'wamid.same-final-turn' });
    await deliver(phone, { option: 'zone_interior', metaMessageId: 'wamid.same-final-turn' });
    expect((await db.pool.query('SELECT count(*) FROM app.reservations')).rows[0]?.count).toBe('1');
  });

  it('says so when the venue is closed that shift', async () => {
    // Dinner runs Monday to Saturday only: ask for a Sunday.
    await seedVenue({ dinnerDays: [1, 2, 3, 4, 5, 6] });
    const reply = await book('+34600000007', { party: '2', when: 'el domingo cena', zone: 'zone_interior' });
    expect(reply).toContain('Estamos cerrados');
    expect((await db.pool.query('SELECT count(*) FROM app.reservations')).rows[0]?.count).toBe('0');
  });

  it('hands a venue with a floor plan Kadensio cannot read to a person', async () => {
    const venue = await seedVenue();
    await db.pool.query(`UPDATE app.clients SET floor_plan_provider='covermanager' WHERE client_id=$1`, [venue.clientId]);
    await book('+34600000008', { party: '2', when: 'el viernes cena', zone: 'zone_interior' });
    expect((await db.pool.query('SELECT count(*) FROM app.reservations')).rows[0]?.count).toBe('0');
    const state = await db.pool.query<{ human_takeover: boolean }>('SELECT human_takeover FROM app.conversations');
    expect(state.rows[0]?.human_takeover).toBe(true);
  });
});
