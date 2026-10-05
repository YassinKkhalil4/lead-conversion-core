import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { describePostgres } from './helpers/postgres.js';

const describePg = describePostgres(['initdb', 'pg_ctl', 'createdb', 'psql']);
const PASSWORD = 'correct-horse-battery-staple-9';

describePg('reservations dashboard API, with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-reservations-api.'));
  const dataDir = join(root, 'data');
  // One port range per test file so parallel files cannot share a cluster:
  // 56_500 runtime, 57_500 health, 58_300 hospitality flow, 58_500 config-seed,
  // 59_500 notification-outbox, 60_500 dashboard-api, 61_700 this file.
  const port = 61_700 + Math.floor(Math.random() * 500);
  const dbName = 'lead_core_reservations_api_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;

  let db: typeof import('../src/db/pool.js');
  let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
  let users: InstanceType<typeof import('../src/services/dashboard/user-service.js').DashboardUserService>;

  interface Seed {
    clientId: string;
    hostA: string;
    hostB: string;
    reservations: { confirmedA: string; requestedA: string; confirmedB: string };
    emails: { manager: string; hostA: string };
  }

  async function seedTenant(key: string, vertical: 'hospitality' | 'real_estate' = 'hospitality'): Promise<Seed> {
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, company_name, timezone, vertical, manager_phone_e164)
       VALUES ($1, $2, 'Europe/Madrid', $3, '+34600000000') RETURNING client_id`,
      [key, `Venue ${key}`, vertical],
    );
    const clientId = client.rows[0]!.client_id;
    const project = await db.pool.query<{ project_id: string }>(
      `INSERT INTO app.projects (client_id, project_name, maps_url) VALUES ($1, $2, 'https://maps.example/x') RETURNING project_id`,
      [clientId, `Place ${key}`],
    );
    const projectId = project.rows[0]!.project_id;
    const zone = await db.pool.query<{ zone_id: string }>(
      `INSERT INTO app.venue_zones (client_id, project_id, zone_key, labels) VALUES ($1, $2, 'terrace', '{"English":"Terrace"}'::jsonb) RETURNING zone_id`,
      [clientId, projectId],
    );
    const shift = await db.pool.query<{ shift_id: string }>(
      `INSERT INTO app.venue_shifts (client_id, project_id, shift_key, labels, starts_at_local, last_seating_local)
       VALUES ($1, $2, 'dinner', '{"English":"Dinner"}'::jsonb, '20:30', '22:30') RETURNING shift_id`,
      [clientId, projectId],
    );
    const hosts = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople (client_id, name, phone_e164) VALUES ($1, 'Host A', $2), ($1, 'Host B', $3) RETURNING salesperson_id`,
      [clientId, `+3461${key.length}000001`, `+3461${key.length}000002`],
    );
    const hostA = hosts.rows[0]!.salesperson_id;
    const hostB = hosts.rows[1]!.salesperson_id;

    async function reservation(n: number, host: string, status: string, depositRequired: boolean): Promise<string> {
      const contact = await db.pool.query<{ contact_id: string }>(
        `INSERT INTO app.contacts (client_id, name, phone_e164) VALUES ($1, $2, $3) RETURNING contact_id`,
        [clientId, `Guest ${n}`, `+3460${key.length}00000${n}`],
      );
      const lead = await db.pool.query<{ lead_id: string }>(
        `INSERT INTO app.leads (client_id, contact_id, project_id, provider, provider_external_id, source, status)
         VALUES ($1, $2, $3, 'whatsapp', $4, 'whatsapp_direct_inbound', 'qualified') RETURNING lead_id`,
        [clientId, contact.rows[0]!.contact_id, projectId, `${key}-${n}`],
      );
      await db.pool.query(
        `INSERT INTO app.lead_assignments (lead_id, salesperson_id, routing_version) VALUES ($1, $2, 'hospitality_v1')`,
        [lead.rows[0]!.lead_id, host],
      );
      const r = await db.pool.query<{ reservation_id: string }>(
        `INSERT INTO app.reservations
          (client_id, project_id, contact_id, lead_id, party_size, service_date, shift_id, zone_id, starts_at, status,
           deposit_required, deposit_status, language, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, current_date + $5::int, $6, $7, now() + ($5::int || ' days')::interval, $8, $9, $10, 'Spanish', $11)
         RETURNING reservation_id`,
        [clientId, projectId, contact.rows[0]!.contact_id, lead.rows[0]!.lead_id, n + 1, shift.rows[0]!.shift_id, zone.rows[0]!.zone_id,
         status, depositRequired, depositRequired ? 'pending' : 'none', `${key}-res-${n}`],
      );
      return r.rows[0]!.reservation_id;
    }

    const confirmedA = await reservation(1, hostA, 'confirmed', false);
    const requestedA = await reservation(2, hostA, 'requested', true);
    const confirmedB = await reservation(3, hostB, 'confirmed', false);

    const emails = { manager: `manager@${key}.test`, hostA: `hosta@${key}.test` };
    await users.create({ clientId, email: emails.manager, password: PASSWORD, name: 'Manager', role: 'manager', salespersonId: null, actorId: 'test' });
    await users.create({ clientId, email: emails.hostA, password: PASSWORD, name: 'Host A', role: 'salesperson', salespersonId: hostA, actorId: 'test' });
    return { clientId, hostA, hostB, reservations: { confirmedA, requestedA, confirmedB }, emails };
  }

  async function login(email: string): Promise<Record<string, string>> {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
    expect(response.statusCode, response.body).toBe(200);
    return { authorization: `Bearer ${response.json().token as string}` };
  }

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${root}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      EDGE_SHARED_SECRET: 'test_shared_secret_123456',
      EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
    };
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });

    vi.resetModules();
    process.env.DATABASE_URL = databaseUrl;
    process.env.EDGE_SHARED_SECRET = env.EDGE_SHARED_SECRET;
    process.env.EDGE_INTERNAL_SECRET = env.EDGE_INTERNAL_SECRET;
    process.env.DASHBOARD_API_ENABLED = 'true';
    process.env.DASHBOARD_SESSION_COOKIE_SECURE = 'false';
    process.env.DASHBOARD_LOGIN_RATE_LIMIT_MAX = '50';

    db = await import('../src/db/pool.js');
    const appModule = await import('../src/app.js');
    const userModule = await import('../src/services/dashboard/user-service.js');
    users = new userModule.DashboardUserService();
    app = await appModule.buildApp();
    await app.ready();
  }, 60_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE edge_client_channels, app.sessions, app.users, app.login_attempts, app.notifications, app.lead_assignments, app.messages,
               app.leads, app.contacts, app.projects, app.salespeople, app.conversations, app.clients,
               runtime.outbox_commands, runtime.scheduled_jobs, audit.events
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    try {
      await app?.close();
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

  it('tells the dashboard which vertical the tenant runs', async () => {
    const seed = await seedTenant('bcnvenue');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: await login(seed.emails.manager) });
    expect(me.json().user.vertical).toBe('hospitality');
  });

  it('lets a manager see every reservation of the venue, with guest, zone and shift', async () => {
    const seed = await seedTenant('bcnvenue');
    const res = await app.inject({ method: 'GET', url: '/api/reservations', headers: await login(seed.emails.manager) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.reservations[0]).toMatchObject({ zone: 'Terrace', shift: 'Dinner', venueName: 'Place bcnvenue', provider: 'kadensio' });
    expect(body.reservations.map((r: { hostName: string }) => r.hostName).sort()).toEqual(['Host A', 'Host A', 'Host B']);
  });

  it('shows a host only the reservations of their own guests', async () => {
    const seed = await seedTenant('bcnvenue');
    const res = await app.inject({ method: 'GET', url: '/api/reservations', headers: await login(seed.emails.hostA) });
    const ids = res.json().reservations.map((r: { reservationId: string }) => r.reservationId);
    expect(ids).toContain(seed.reservations.confirmedA);
    expect(ids).toContain(seed.reservations.requestedA);
    expect(ids).not.toContain(seed.reservations.confirmedB);
    const other = await app.inject({ method: 'GET', url: `/api/reservations/${seed.reservations.confirmedB}`, headers: await login(seed.emails.hostA) });
    expect(other.statusCode).toBe(404);
  });

  it('never leaks another tenant\'s reservations', async () => {
    const mine = await seedTenant('bcnvenue');
    const theirs = await seedTenant('madridvenue');
    const headers = await login(mine.emails.manager);
    const list = await app.inject({ method: 'GET', url: '/api/reservations', headers });
    const ids = list.json().reservations.map((r: { reservationId: string }) => r.reservationId);
    expect(ids).not.toContain(theirs.reservations.confirmedA);
    const direct = await app.inject({ method: 'GET', url: `/api/reservations/${theirs.reservations.confirmedA}`, headers });
    expect(direct.statusCode).toBe(404);
    const confirm = await app.inject({ method: 'POST', url: `/api/reservations/${theirs.reservations.requestedA}/confirm`, headers, payload: {} });
    expect(confirm.statusCode).toBe(404);
  });

  it('filters by status and date range', async () => {
    const seed = await seedTenant('bcnvenue');
    const headers = await login(seed.emails.manager);
    const requested = await app.inject({ method: 'GET', url: '/api/reservations?status=requested', headers });
    expect(requested.json().reservations).toHaveLength(1);
    const none = await app.inject({ method: 'GET', url: '/api/reservations?from=2999-01-01', headers });
    expect(none.json().total).toBe(0);
    const bad = await app.inject({ method: 'GET', url: '/api/reservations?status=banana', headers });
    expect(bad.statusCode).toBe(400);
  });

  it('confirms a held reservation, records the deposit, and says the guest could not be messaged outside the window', async () => {
    const seed = await seedTenant('bcnvenue');
    const headers = await login(seed.emails.hostA);
    const res = await app.inject({
      method: 'POST', url: `/api/reservations/${seed.reservations.requestedA}/confirm`, headers, payload: { depositStatus: 'paid' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().reservation).toMatchObject({ status: 'confirmed', depositStatus: 'paid' });
    // No open WhatsApp session in this fixture: the host is told, the confirm still stands.
    expect(res.json().guestNotified).toBe(false);
    const stage = await db.pool.query(`SELECT pipeline_stage FROM app.leads l JOIN app.reservations r USING (lead_id) WHERE r.reservation_id=$1`, [seed.reservations.requestedA]);
    expect(stage.rows[0]?.pipeline_stage).toBe('site_visit_scheduled');
    const again = await app.inject({ method: 'POST', url: `/api/reservations/${seed.reservations.requestedA}/confirm`, headers, payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it('messages the guest from the venue\'s own WhatsApp number when the window is open', async () => {
    const seed = await seedTenant('bcnvenue');
    await db.pool.query(
      `INSERT INTO edge_client_channels (phone_number_id, client_record_id, client_id, company_name, active, direct_send_enabled, graph_phone_number_id)
       VALUES ('venue-number-777', 'rec_bcnvenue', $1, 'Venue', true, true, 'venue-number-777')`,
      [seed.clientId],
    );
    await db.pool.query(
      `INSERT INTO app.conversations (client_id, contact_id, lead_id, preferred_language, last_inbound_at, conversation_window_expires_at)
       SELECT r.client_id, r.contact_id, r.lead_id, 'Spanish', now(), now() + interval '20 hours'
       FROM app.reservations r WHERE r.reservation_id=$1`,
      [seed.reservations.requestedA],
    );
    const res = await app.inject({
      method: 'POST', url: `/api/reservations/${seed.reservations.requestedA}/confirm`, headers: await login(seed.emails.hostA), payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().guestNotified).toBe(true);
    const sent = await db.pool.query(`SELECT payload_json FROM runtime.outbox_commands WHERE command_type='whatsapp.send_message'`);
    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0]?.payload_json.phoneNumberId).toBe('venue-number-777');
    expect(sent.rows[0]?.payload_json.message.text).toContain('ha confirmado tu mesa para 3');
  });

  it('cancels a reservation and frees it; a cancelled one cannot be cancelled again', async () => {
    const seed = await seedTenant('bcnvenue');
    const headers = await login(seed.emails.manager);
    const res = await app.inject({ method: 'POST', url: `/api/reservations/${seed.reservations.confirmedA}/cancel`, headers });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().reservation.status).toBe('cancelled');
    const again = await app.inject({ method: 'POST', url: `/api/reservations/${seed.reservations.confirmedA}/cancel`, headers });
    expect(again.statusCode).toBe(409);
  });

  it('walks a confirmed reservation through seated and completed, and refuses a jump', async () => {
    const seed = await seedTenant('bcnvenue');
    const headers = await login(seed.emails.manager);
    const url = `/api/reservations/${seed.reservations.confirmedA}/status`;
    expect((await app.inject({ method: 'POST', url, headers, payload: { status: 'seated' } })).json().reservation.status).toBe('seated');
    expect((await app.inject({ method: 'POST', url, headers, payload: { status: 'completed' } })).json().reservation.status).toBe('completed');
    expect((await app.inject({ method: 'POST', url, headers, payload: { status: 'seated' } })).statusCode).toBe(409);
    // A held request cannot be marked no-show before it is confirmed.
    const held = await app.inject({ method: 'POST', url: `/api/reservations/${seed.reservations.requestedA}/status`, headers, payload: { status: 'no_show' } });
    expect(held.statusCode).toBe(409);
  });

  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reservations' });
    expect(res.statusCode).toBe(401);
  });
});
