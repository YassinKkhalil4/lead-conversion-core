import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function commandExists(command: string): boolean {
  try {
    execFileSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasPostgres = ['initdb', 'pg_ctl', 'createdb'].every(commandExists);
const describePg = hasPostgres ? describe : describe.skip;

const PASSWORD = 'dashboard-test-password-1';

interface Tenant {
  clientId: string;
  clientKey: string;
  contactId: string;
  leadId: string;
  otherLeadId: string;
  salespersonId: string;
  otherSalespersonId: string;
  projectId: string;
  assignmentId: string;
  notificationId: string;
  operatorNotificationId: string;
  adminEmail: string;
  managerEmail: string;
  salespersonEmail: string;
}

describePg('dashboard API with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-dashboard-test.'));
  const dataDir = join(root, 'data');
  const port = 57_500 + Math.floor(Math.random() * 1000);
  const dbName = 'lead_core_dashboard_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;

  let db: typeof import('../src/db/pool.js');
  let appModule: typeof import('../src/app.js');
  let userService: typeof import('../src/services/dashboard/user-service.js');
  let slaService: typeof import('../src/services/sla-service.js');
  let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
  let tenantA: Tenant;
  let tenantB: Tenant;

  async function seedTenant(suffix: string): Promise<Tenant> {
    const client = await db.pool.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, company_name, manager_name, manager_phone_e164, legacy_airtable_id)
       VALUES ($1, $2, 'Manager', $3, $4)
       RETURNING client_id`,
      [`client_${suffix}`, `Company ${suffix}`, `+2010000000${suffix.length}`, `rec_client_${suffix}`],
    );
    const clientId = client.rows[0]!.client_id;

    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, name, phone_e164, email)
       VALUES ($1, $2, $3, $4)
       RETURNING contact_id`,
      [clientId, `عميل ${suffix}`, `+2011111${suffix.charCodeAt(0)}0001`, `lead_${suffix}@example.test`],
    );
    const contactId = contact.rows[0]!.contact_id;

    const salespeople = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople (client_id, name, phone_e164, unit_specialties, locations, languages, priority_rank)
       VALUES
         ($1, $2, $3, ARRAY['Apartment'], ARRAY['New Cairo'], ARRAY['Arabic'], 1),
         ($1, $4, $5, ARRAY['Villa'], ARRAY['Sheikh Zayed'], ARRAY['English'], 2)
       RETURNING salesperson_id`,
      [
        clientId,
        `Sales One ${suffix}`,
        `+2012222${suffix.charCodeAt(0)}0001`,
        `Sales Two ${suffix}`,
        `+2012222${suffix.charCodeAt(0)}0002`,
      ],
    );
    const salespersonId = salespeople.rows[0]!.salesperson_id;
    const otherSalespersonId = salespeople.rows[1]!.salesperson_id;

    const project = await db.pool.query<{ project_id: string }>(
      `INSERT INTO app.projects (client_id, project_name, unit_types, location)
       VALUES ($1, $2, ARRAY['Apartment'], 'New Cairo')
       RETURNING project_id`,
      [clientId, `Project ${suffix}`],
    );
    const projectId = project.rows[0]!.project_id;

    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, project_id, provider, provider_external_id, source, status,
         current_stage, temperature, lead_score, first_received_at, first_contacted_at)
       VALUES ($1, $2, $3, 'website', $4, 'website', 'qualified', 'qualified', 'hot', 100,
               now() - interval '3 hours', now() - interval '2 hours 55 minutes')
       RETURNING lead_id`,
      [clientId, contactId, projectId, `ext_${suffix}_1`],
    );
    const leadId = lead.rows[0]!.lead_id;

    const otherLead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, provider, provider_external_id, source, status, temperature)
       VALUES ($1, $2, 'facebook', $3, 'facebook', 'open', 'warm')
       RETURNING lead_id`,
      [clientId, contactId, `ext_${suffix}_2`],
    );
    const otherLeadId = otherLead.rows[0]!.lead_id;

    const assignment = await db.pool.query<{ lead_assignment_id: string }>(
      `INSERT INTO app.lead_assignments (lead_id, salesperson_id, routing_version, status, assigned_at)
       VALUES ($1, $2, 'routing-v1', 'assigned', now() - interval '20 minutes')
       RETURNING lead_assignment_id`,
      [leadId, salespersonId],
    );
    const assignmentId = assignment.rows[0]!.lead_assignment_id;

    const scoreRun = await db.pool.query<{ score_run_id: string }>(
      `INSERT INTO app.score_runs (lead_id, scoring_version, score, temperature, factors_json, input_hash)
       VALUES ($1, 'scoring-v1', 100, 'hot', $2::jsonb, $3)
       RETURNING score_run_id`,
      [
        leadId,
        JSON.stringify({
          factors: [
            { key: 'base', value: true, points: 10, reason: 'baseline' },
            { key: 'budget', value: '5000000', points: 25, reason: 'budget_in_range' },
          ],
          missingAnswers: ['q_down_payment'],
        }),
        `hash_${suffix}`,
      ],
    );

    await db.pool.query(
      `INSERT INTO app.routing_runs
        (lead_id, score_run_id, routing_version, input_hash, outcome, selected_salesperson_id, candidates_json, reasons_json)
       VALUES ($1, $2, 'routing-v1', $3, 'assigned', $4, $5::jsonb, $6::jsonb)`,
      [
        leadId,
        scoreRun.rows[0]!.score_run_id,
        `hash_${suffix}`,
        salespersonId,
        JSON.stringify([
          {
            name: `Sales One ${suffix}`,
            rank: 1,
            score: 90,
            phoneE164: `+2012222${suffix.charCodeAt(0)}0001`,
            unitMatch: true,
            priorityRank: 1,
            languageMatch: true,
            locationMatch: true,
            salespersonId,
            activeAssignmentCount: 1,
          },
          {
            name: `Sales Two ${suffix}`,
            rank: 2,
            score: 40,
            phoneE164: `+2012222${suffix.charCodeAt(0)}0002`,
            unitMatch: false,
            priorityRank: 2,
            languageMatch: false,
            locationMatch: false,
            salespersonId: otherSalespersonId,
            activeAssignmentCount: 0,
          },
        ]),
        JSON.stringify({ selected: 'best_match' }),
      ],
    );

    const session = await db.pool.query<{ qualification_session_id: string }>(
      `INSERT INTO app.qualification_sessions (lead_id, status, completed_at)
       VALUES ($1, 'completed', now())
       RETURNING qualification_session_id`,
      [leadId],
    );
    await db.pool.query(
      `INSERT INTO app.qualification_answers (qualification_session_id, question_key, normalized_value, raw_value)
       VALUES ($1, 'q_location', 'New Cairo', 'القاهرة الجديدة'),
              ($1, 'q_budget', '5000000', '٥ مليون')`,
      [session.rows[0]!.qualification_session_id],
    );

    await db.pool.query(
      `INSERT INTO app.messages (lead_id, client_id, contact_id, direction, message_text, message_type, state, created_at)
       VALUES ($1, $2, $3, 'outbound', 'أهلاً بيك', 'template', 'delivered', now() - interval '2 hours'),
              ($1, $2, $3, 'inbound', 'مهتم بشقة في القاهرة الجديدة', 'text', 'delivered', now() - interval '90 minutes')`,
      [leadId, clientId, contactId],
    );

    const outbox = await db.pool.query<{ outbox_command_id: string }>(
      `INSERT INTO runtime.outbox_commands (command_type, destination, idempotency_key, payload_json)
       VALUES ('salesperson.lead_assignment_notification', 'x', $1, '{}'::jsonb),
              ('operator.sla_escalation', 'y', $2, '{}'::jsonb)
       RETURNING outbox_command_id`,
      [`notify_${suffix}_1`, `notify_${suffix}_2`],
    );

    const notification = await db.pool.query<{ notification_id: string }>(
      `INSERT INTO app.notifications
        (source_outbox_command_id, client_id, recipient_type, recipient_id, notification_type, payload_json, priority)
       VALUES ($1, $2, 'salesperson', $3, 'salesperson.lead_assignment_notification', $4::jsonb, 'normal')
       RETURNING notification_id`,
      [outbox.rows[0]!.outbox_command_id, clientId, salespersonId, JSON.stringify({ leadId })],
    );
    const operatorNotification = await db.pool.query<{ notification_id: string }>(
      `INSERT INTO app.notifications
        (source_outbox_command_id, client_id, recipient_type, notification_type, payload_json, priority)
       VALUES ($1, $2, 'operator', 'operator.sla_escalation', $3::jsonb, 'high')
       RETURNING notification_id`,
      [outbox.rows[1]!.outbox_command_id, clientId, JSON.stringify({ leadId })],
    );

    const users = new userService.DashboardUserService();
    const adminEmail = `admin_${suffix}@example.test`;
    const managerEmail = `manager_${suffix}@example.test`;
    const salespersonEmail = `sales_${suffix}@example.test`;
    await users.create({
      clientId,
      email: adminEmail,
      password: PASSWORD,
      name: `Admin ${suffix}`,
      role: 'admin',
      salespersonId: null,
      actorId: 'test',
    });
    await users.create({
      clientId,
      email: managerEmail,
      password: PASSWORD,
      name: `Manager ${suffix}`,
      role: 'manager',
      salespersonId: null,
      actorId: 'test',
    });
    await users.create({
      clientId,
      email: salespersonEmail,
      password: PASSWORD,
      name: `Sales One ${suffix}`,
      role: 'salesperson',
      salespersonId,
      actorId: 'test',
    });

    return {
      clientId,
      clientKey: `client_${suffix}`,
      contactId,
      leadId,
      otherLeadId,
      salespersonId,
      otherSalespersonId,
      projectId,
      assignmentId,
      notificationId: notification.rows[0]!.notification_id,
      operatorNotificationId: operatorNotification.rows[0]!.notification_id,
      adminEmail,
      managerEmail,
      salespersonEmail,
    };
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().token as string;
  }

  function authed(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${root}`, '-l', join(root, 'postgres.log'), 'start'], {
      stdio: 'ignore',
    });
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
    process.env.DASHBOARD_LOGIN_RATE_LIMIT_MAX = '5';
    process.env.DASHBOARD_LOGIN_RATE_LIMIT_WINDOW_MS = '900000';
    process.env.META_APPROVED_TEMPLATE_NAMES = 'lead_welcome';

    db = await import('../src/db/pool.js');
    appModule = await import('../src/app.js');
    userService = await import('../src/services/dashboard/user-service.js');
    slaService = await import('../src/services/sla-service.js');
    app = await appModule.buildApp();
    await app.ready();
  }, 60_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE
        app.sessions, app.users, app.login_attempts,
        app.notifications, app.device_tokens,
        app.sla_jobs, app.followups,
        app.qualification_answers, app.qualification_sessions,
        app.routing_runs, app.score_runs,
        app.lead_assignments, app.messages, app.leads,
        app.contacts, app.projects, app.salespeople,
        app.conversations, app.clients,
        runtime.outbox_commands, runtime.scheduled_jobs,
        audit.events
      RESTART IDENTITY CASCADE
    `);
    tenantA = await seedTenant('a');
    tenantB = await seedTenant('b');
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.closePool();
    try {
      execFileSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
    } catch {
      // The cluster is disposable; a failed stop must not fail the suite.
    }
    rmSync(root, { recursive: true, force: true });
  }, 30_000);

  describe('authentication', () => {
    it('issues a session token and an httpOnly cookie on valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: tenantA.adminEmail, password: PASSWORD },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(String(body.token)).toHaveLength(64);
      expect(body.user.clientId).toBe(tenantA.clientId);
      expect(body.user.role).toBe('admin');
      expect(body.user).not.toHaveProperty('password_hash');
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('rejects a wrong password without revealing whether the account exists', async () => {
      const wrongPassword = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: tenantA.adminEmail, password: 'not-the-password' },
      });
      const unknownEmail = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.test', password: PASSWORD },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json().error).toBe('invalid_credentials');
      expect(unknownEmail.json().error).toBe('invalid_credentials');
    });

    it('rate limits login to five attempts per window and reports retry-after', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: tenantA.adminEmail, password: 'wrong' },
        });
        expect(response.statusCode).toBe(401);
      }
      const blocked = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: tenantA.adminEmail, password: PASSWORD },
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe('login_rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('accepts the session from a cookie as well as a bearer header', async () => {
      const token = await login(tenantA.managerEmail);
      const bearer = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authed(token) });
      const cookie = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `lcc_session=${token}` },
      });
      expect(bearer.statusCode).toBe(200);
      expect(cookie.statusCode).toBe(200);
      expect(cookie.json().user.email).toBe(tenantA.managerEmail);
    });

    it('refuses an expired session', async () => {
      const token = await login(tenantA.adminEmail);
      await db.pool.query(`UPDATE app.sessions SET expires_at = now() - interval '1 minute'`);
      const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authed(token) });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('unauthenticated');
    });

    it('refuses a revoked session after logout and extends expiry on refresh', async () => {
      const token = await login(tenantA.adminEmail);
      const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: authed(token) });
      expect(refreshed.statusCode).toBe(200);
      expect(Date.parse(refreshed.json().expiresAt)).toBeGreaterThan(Date.now());

      const loggedOut = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authed(token) });
      expect(loggedOut.statusCode).toBe(200);
      const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authed(token) });
      expect(afterLogout.statusCode).toBe(401);
    });

    it('refuses every dashboard route without a session', async () => {
      for (const url of ['/api/leads', '/api/notifications', '/api/salespeople', '/api/projects', '/api/dashboard/summary']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(401);
      }
    });
  });

  describe('cross-client isolation', () => {
    it('returns zero rows from the other client for every list endpoint', async () => {
      const token = await login(tenantA.adminEmail);
      const headers = authed(token);

      const leads = await app.inject({ method: 'GET', url: '/api/leads?limit=100', headers });
      expect(leads.statusCode).toBe(200);
      const leadIds = leads.json().leads.map((lead: { leadId: string }) => lead.leadId);
      expect(leadIds).toContain(tenantA.leadId);
      expect(leadIds).not.toContain(tenantB.leadId);
      expect(leadIds).not.toContain(tenantB.otherLeadId);
      for (const lead of leads.json().leads) {
        expect(lead.clientId).toBe(tenantA.clientId);
      }

      const salespeople = await app.inject({ method: 'GET', url: '/api/salespeople', headers });
      const salespersonIds = salespeople.json().salespeople.map((s: { salespersonId: string }) => s.salespersonId);
      expect(salespersonIds).toContain(tenantA.salespersonId);
      expect(salespersonIds).not.toContain(tenantB.salespersonId);

      const projects = await app.inject({ method: 'GET', url: '/api/projects', headers });
      const projectIds = projects.json().projects.map((p: { projectId: string }) => p.projectId);
      expect(projectIds).toContain(tenantA.projectId);
      expect(projectIds).not.toContain(tenantB.projectId);

      const notifications = await app.inject({ method: 'GET', url: '/api/notifications', headers });
      const notificationIds = notifications.json().notifications.map((n: { notificationId: string }) => n.notificationId);
      expect(notificationIds).toContain(tenantA.operatorNotificationId);
      expect(notificationIds).not.toContain(tenantB.operatorNotificationId);
      expect(notificationIds).not.toContain(tenantB.notificationId);

      const users = await app.inject({ method: 'GET', url: '/api/users', headers });
      const emails = users.json().users.map((u: { email: string }) => u.email);
      expect(emails).toContain(tenantA.adminEmail);
      expect(emails).not.toContain(tenantB.adminEmail);

      const activity = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=200', headers });
      expect(activity.statusCode).toBe(200);
      for (const event of activity.json().activity) {
        expect(event.aggregateId).not.toBe(tenantB.leadId);
        expect(event.aggregateId).not.toBe(tenantB.salespersonId);
      }

      const messages = await app.inject({ method: 'GET', url: `/api/leads/${tenantA.leadId}/messages`, headers });
      expect(messages.statusCode).toBe(200);
      expect(messages.json().messages.length).toBeGreaterThan(0);
    });

    it('counts only its own client in the summary', async () => {
      const tokenA = await login(tenantA.adminEmail);
      const summaryA = await app.inject({
        method: 'GET',
        url: '/api/dashboard/summary',
        headers: authed(tokenA),
      });
      expect(summaryA.statusCode).toBe(200);
      // Each tenant is seeded with exactly two leads.
      expect(summaryA.json().summary.periods.month.newLeads).toBe(2);
    });

    it('refuses reads and writes against another client\'s lead', async () => {
      const token = await login(tenantA.adminEmail);
      const headers = authed(token);
      const reads = [
        { method: 'GET' as const, url: `/api/leads/${tenantB.leadId}` },
        { method: 'GET' as const, url: `/api/leads/${tenantB.leadId}/messages` },
      ];
      for (const read of reads) {
        const response = await app.inject({ ...read, headers });
        expect(response.statusCode, read.url).toBe(404);
      }

      const writes = [
        { url: `/api/leads/${tenantB.leadId}/acknowledge`, payload: {} },
        { url: `/api/leads/${tenantB.leadId}/close`, payload: { reason: 'won' } },
        { url: `/api/leads/${tenantB.leadId}/stop-followup`, payload: { reason: 'manual' } },
        { url: `/api/leads/${tenantB.leadId}/takeover`, payload: { enabled: true } },
        {
          url: `/api/leads/${tenantB.leadId}/reply`,
          payload: { requestKey: 'isolation-check-1', payload: { kind: 'text', text: 'hi' } },
        },
      ];
      for (const write of writes) {
        const response = await app.inject({ method: 'POST', url: write.url, headers, payload: write.payload });
        expect(response.statusCode, write.url).toBe(404);
      }
      const stillOpen = await db.pool.query('SELECT status FROM app.leads WHERE lead_id = $1', [tenantB.leadId]);
      expect(stillOpen.rows[0]?.status).toBe('qualified');
    });

    it('refuses to mark another client\'s notification read', async () => {
      const token = await login(tenantA.adminEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/${tenantB.operatorNotificationId}/read`,
        headers: authed(token),
      });
      expect(response.statusCode).toBe(404);
      const row = await db.pool.query('SELECT read_at FROM app.notifications WHERE notification_id = $1', [
        tenantB.operatorNotificationId,
      ]);
      expect(row.rows[0]?.read_at).toBeNull();
    });

    it('refuses to update another client\'s salesperson or project', async () => {
      const token = await login(tenantA.adminEmail);
      const headers = authed(token);
      const salesperson = await app.inject({
        method: 'PATCH',
        url: `/api/salespeople/${tenantB.salespersonId}`,
        headers,
        payload: { name: 'Hijacked' },
      });
      const project = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${tenantB.projectId}`,
        headers,
        payload: { projectName: 'Hijacked' },
      });
      expect(salesperson.statusCode).toBe(404);
      expect(project.statusCode).toBe(404);
      const check = await db.pool.query('SELECT name FROM app.salespeople WHERE salesperson_id = $1', [
        tenantB.salespersonId,
      ]);
      expect(check.rows[0]?.name).toBe('Sales One b');
    });
  });

  describe('role restrictions', () => {
    it('limits a salesperson to their own and unassigned leads', async () => {
      await db.pool.query(
        `INSERT INTO app.lead_assignments (lead_id, salesperson_id, routing_version, status)
         VALUES ($1, $2, 'routing-v1', 'assigned')`,
        [tenantA.otherLeadId, tenantA.otherSalespersonId],
      );
      const token = await login(tenantA.salespersonEmail);
      const response = await app.inject({ method: 'GET', url: '/api/leads?limit=100', headers: authed(token) });
      const ids = response.json().leads.map((lead: { leadId: string }) => lead.leadId);
      expect(ids).toContain(tenantA.leadId);
      expect(ids).not.toContain(tenantA.otherLeadId);

      const forbiddenDetail = await app.inject({
        method: 'GET',
        url: `/api/leads/${tenantA.otherLeadId}`,
        headers: authed(token),
      });
      expect(forbiddenDetail.statusCode).toBe(404);
    });

    it('shows a salesperson leads that nobody is assigned to', async () => {
      const token = await login(tenantA.salespersonEmail);
      const response = await app.inject({ method: 'GET', url: '/api/leads?limit=100', headers: authed(token) });
      const ids = response.json().leads.map((lead: { leadId: string }) => lead.leadId);
      expect(ids).toContain(tenantA.otherLeadId);
    });

    it('refuses salesperson writes to salespeople and projects', async () => {
      const token = await login(tenantA.salespersonEmail);
      const headers = authed(token);
      const create = await app.inject({
        method: 'POST',
        url: '/api/salespeople',
        headers,
        payload: { name: 'New', phoneE164: '+201234567890' },
      });
      const project = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers,
        payload: { projectName: 'New project' },
      });
      expect(create.statusCode).toBe(403);
      expect(project.statusCode).toBe(403);
      expect(create.json().error).toBe('role_not_permitted');
    });

    it('reserves user management for admins', async () => {
      const managerToken = await login(tenantA.managerEmail);
      const adminToken = await login(tenantA.adminEmail);
      const managerAttempt = await app.inject({
        method: 'GET',
        url: '/api/users',
        headers: authed(managerToken),
      });
      const adminAttempt = await app.inject({ method: 'GET', url: '/api/users', headers: authed(adminToken) });
      expect(managerAttempt.statusCode).toBe(403);
      expect(adminAttempt.statusCode).toBe(200);
    });

    it('lets a manager create a salesperson inside their own client only', async () => {
      const token = await login(tenantA.managerEmail);
      const created = await app.inject({
        method: 'POST',
        url: '/api/salespeople',
        headers: authed(token),
        payload: { name: 'Third', phoneE164: '+201999999999', locations: ['New Cairo'] },
      });
      expect(created.statusCode).toBe(200);
      const row = await db.pool.query('SELECT client_id FROM app.salespeople WHERE salesperson_id = $1', [
        created.json().salesperson.salespersonId,
      ]);
      expect(row.rows[0]?.client_id).toBe(tenantA.clientId);
    });
  });

  describe('lead detail', () => {
    it('returns qualification answers in configured order with skipped questions kept visible', async () => {
      const token = await login(tenantA.adminEmail);
      const response = await app.inject({ method: 'GET', url: `/api/leads/${tenantA.leadId}`, headers: authed(token) });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const keys = body.qualification.answers.map((answer: { questionKey: string }) => answer.questionKey);
      expect(keys[0]).toBe('q_permission');
      expect(keys).toContain('q_site_visit');
      const budget = body.qualification.answers.find((a: { questionKey: string }) => a.questionKey === 'q_budget');
      const permission = body.qualification.answers.find((a: { questionKey: string }) => a.questionKey === 'q_permission');
      expect(budget.answered).toBe(true);
      expect(budget.rawValue).toBe('٥ مليون');
      expect(permission.answered).toBe(false);
    });

    it('exposes the score breakdown, missing answers and routing candidates', async () => {
      const token = await login(tenantA.adminEmail);
      const response = await app.inject({ method: 'GET', url: `/api/leads/${tenantA.leadId}`, headers: authed(token) });
      const body = response.json();
      expect(body.latestScoreRun.score).toBe(100);
      expect(body.latestScoreRun.missingAnswers).toEqual(['q_down_payment']);
      expect(body.latestScoreRun.factors[0]).toMatchObject({ key: 'base', points: 10, reason: 'baseline' });
      expect(body.latestRoutingRun.outcome).toBe('assigned');
      expect(body.latestRoutingRun.candidates).toHaveLength(2);
      expect(body.latestRoutingRun.candidates[0]).toMatchObject({
        rank: 1,
        unitMatch: true,
        languageMatch: true,
        locationMatch: true,
        selected: true,
      });
      expect(body.latestRoutingRun.candidates[1].selected).toBe(false);
      expect(body.messages.map((m: { direction: string }) => m.direction)).toEqual(['outbound', 'inbound']);
      expect(body.lead.sessionWindowOpen).toBe(true);
    });
  });

  describe('actions', () => {
    it('acknowledges an assignment, cancels its SLA jobs and writes an audit row', async () => {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await new slaService.SlaService().scheduleForAssignment(client, {
          leadAssignmentId: tenantA.assignmentId,
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const scheduled = await db.pool.query(
        `SELECT status FROM runtime.scheduled_jobs WHERE aggregate_key = $1`,
        [tenantA.leadId],
      );
      expect(scheduled.rows).toHaveLength(2);
      expect(scheduled.rows.every((row) => row.status === 'pending')).toBe(true);

      const token = await login(tenantA.salespersonEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/acknowledge`,
        headers: authed(token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().slaJobsCancelled).toBe(2);

      const afterJobs = await db.pool.query(
        `SELECT status FROM runtime.scheduled_jobs WHERE aggregate_key = $1`,
        [tenantA.leadId],
      );
      expect(afterJobs.rows.every((row) => row.status === 'cancelled')).toBe(true);
      const slaRows = await db.pool.query(`SELECT status FROM app.sla_jobs WHERE lead_id = $1`, [tenantA.leadId]);
      expect(slaRows.rows.every((row) => row.status === 'cancelled')).toBe(true);

      const acknowledged = await db.pool.query(
        'SELECT acknowledged_at FROM app.lead_assignments WHERE lead_assignment_id = $1',
        [tenantA.assignmentId],
      );
      expect(acknowledged.rows[0]?.acknowledged_at).not.toBeNull();

      const audit = await db.pool.query(
        `SELECT actor_id, payload_json FROM audit.events
         WHERE event_type = 'dashboard.assignment_acknowledged' AND aggregate_id = $1`,
        [tenantA.leadId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.payload_json.slaJobsCancelled).toBe(2);
    });

    it('refuses to acknowledge an assignment held by another salesperson', async () => {
      // The lead was reassigned: this salesperson still sees it because of the
      // closed historical assignment, but the live one belongs to a colleague.
      await db.pool.query('UPDATE app.lead_assignments SET status = $2 WHERE lead_assignment_id = $1', [
        tenantA.assignmentId,
        'closed',
      ]);
      await db.pool.query(
        `INSERT INTO app.lead_assignments (lead_id, salesperson_id, routing_version, status)
         VALUES ($1, $2, 'routing-v1', 'assigned')`,
        [tenantA.leadId, tenantA.otherSalespersonId],
      );
      const token = await login(tenantA.salespersonEmail);
      const visible = await app.inject({
        method: 'GET',
        url: `/api/leads/${tenantA.leadId}`,
        headers: authed(token),
      });
      expect(visible.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/acknowledge`,
        headers: authed(token),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('assignment_belongs_to_another_salesperson');
    });

    it('hides a reassigned lead from a salesperson who never held it', async () => {
      await db.pool.query('UPDATE app.lead_assignments SET salesperson_id = $2 WHERE lead_assignment_id = $1', [
        tenantA.assignmentId,
        tenantA.otherSalespersonId,
      ]);
      const token = await login(tenantA.salespersonEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/acknowledge`,
        headers: authed(token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('closes a lead and cancels its scheduled follow-ups', async () => {
      await db.pool.query(
        `INSERT INTO runtime.scheduled_jobs (job_key, job_type, aggregate_key, due_at, status)
         VALUES ($1, 'followup.send', $2, now() + interval '1 day', 'pending')`,
        [`followup:${tenantA.leadId}:default:qualified:step:1`, tenantA.leadId],
      );
      const job = await db.pool.query('SELECT scheduled_job_id FROM runtime.scheduled_jobs WHERE job_key = $1', [
        `followup:${tenantA.leadId}:default:qualified:step:1`,
      ]);
      await db.pool.query(
        `INSERT INTO app.followups (lead_id, status, due_at, semantic_key, scheduled_job_id)
         VALUES ($1, 'scheduled', now() + interval '1 day', $2, $3)`,
        [tenantA.leadId, `followup:${tenantA.leadId}:default:qualified:step:1`, job.rows[0]!.scheduled_job_id],
      );

      const token = await login(tenantA.managerEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/close`,
        headers: authed(token),
        payload: { reason: 'won' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().followupsCancelled).toBe(1);

      const lead = await db.pool.query('SELECT status, closed_status FROM app.leads WHERE lead_id = $1', [
        tenantA.leadId,
      ]);
      expect(lead.rows[0]).toMatchObject({ status: 'closed', closed_status: 'won' });
      const cancelled = await db.pool.query('SELECT status FROM runtime.scheduled_jobs WHERE job_key = $1', [
        `followup:${tenantA.leadId}:default:qualified:step:1`,
      ]);
      expect(cancelled.rows[0]?.status).toBe('cancelled');
    });

    it('stops follow-ups and records the reason on the lead', async () => {
      const token = await login(tenantA.managerEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/stop-followup`,
        headers: authed(token),
        payload: { reason: 'customer_asked' },
      });
      expect(response.statusCode).toBe(200);
      const lead = await db.pool.query('SELECT stop_follow_up, stop_reason FROM app.leads WHERE lead_id = $1', [
        tenantA.leadId,
      ]);
      expect(lead.rows[0]).toMatchObject({ stop_follow_up: true, stop_reason: 'customer_asked' });
    });

    it('suppresses the automated reply path when a human takes over', async () => {
      const token = await login(tenantA.managerEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/takeover`,
        headers: authed(token),
        payload: { enabled: true },
      });
      expect(response.statusCode).toBe(200);
      const control = await db.pool.query(
        'SELECT human_takeover, current_stage FROM edge_lead_controls WHERE phone_normalized = $1',
        [`+2011111${'a'.charCodeAt(0)}0001`],
      );
      expect(control.rows[0]).toMatchObject({ human_takeover: true, current_stage: 'human_takeover' });
    });
  });

  describe('reply and the 24-hour session window', () => {
    it('queues free-form text through the outbox while the window is open', async () => {
      const token = await login(tenantA.managerEmail);
      const response = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/reply`,
        headers: authed(token),
        payload: { requestKey: 'reply-open-window-1', payload: { kind: 'text', text: 'تمام، هكلمك حالاً' } },
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json();
      expect(body.sessionWindowOpen).toBe(true);

      const command = await db.pool.query(
        'SELECT command_type, state, payload_json FROM runtime.outbox_commands WHERE outbox_command_id = $1',
        [body.outboxCommandId],
      );
      expect(command.rows[0]?.command_type).toBe('whatsapp.send_message');
      expect(command.rows[0]?.state).toBe('pending');
      const message = await db.pool.query('SELECT direction, state, message_text FROM app.messages WHERE message_id = $1', [
        body.messageId,
      ]);
      expect(message.rows[0]).toMatchObject({ direction: 'outbound', state: 'queued' });
    });

    it('is idempotent for a retried request key', async () => {
      const token = await login(tenantA.managerEmail);
      const payload = { requestKey: 'retry-after-signal-loss', payload: { kind: 'text', text: 'مرحبا' } };
      const first = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/reply`,
        headers: authed(token),
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/reply`,
        headers: authed(token),
        payload,
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().messageId).toBe(first.json().messageId);
      expect(second.json().outboxCommandId).toBe(first.json().outboxCommandId);
    });

    it('refuses free-form text once the window has closed and allows an approved template', async () => {
      await db.pool.query(
        `UPDATE app.messages SET created_at = now() - interval '30 hours' WHERE lead_id = $1`,
        [tenantA.leadId],
      );
      const token = await login(tenantA.managerEmail);
      const blocked = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/reply`,
        headers: authed(token),
        payload: { requestKey: 'closed-window-1', payload: { kind: 'text', text: 'late reply' } },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toBe('session_window_closed');
      expect(blocked.json().allowedMessageKind).toBe('template');

      const template = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/reply`,
        headers: authed(token),
        payload: {
          requestKey: 'closed-window-2',
          payload: { kind: 'template', templateName: 'lead_welcome', languageCode: 'ar' },
        },
      });
      expect(template.statusCode, template.body).toBe(200);
      const unapproved = await app.inject({
        method: 'POST',
        url: `/api/leads/${tenantA.leadId}/reply`,
        headers: authed(token),
        payload: {
          requestKey: 'closed-window-3',
          payload: { kind: 'template', templateName: 'not_approved', languageCode: 'ar' },
        },
      });
      expect(unapproved.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('notifications', () => {
    it('lists a salesperson\'s own notifications unread first and marks them read', async () => {
      const token = await login(tenantA.salespersonEmail);
      const headers = authed(token);
      const listed = await app.inject({ method: 'GET', url: '/api/notifications', headers });
      expect(listed.statusCode).toBe(200);
      const body = listed.json();
      expect(body.unreadCount).toBe(1);
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].notificationId).toBe(tenantA.notificationId);
      expect(body.notifications[0].leadId).toBe(tenantA.leadId);
      expect(body.notifications[0].readAt).toBeNull();

      const read = await app.inject({
        method: 'POST',
        url: `/api/notifications/${tenantA.notificationId}/read`,
        headers,
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().notification.readAt).not.toBeNull();

      const unreadOnly = await app.inject({ method: 'GET', url: '/api/notifications?unread=true', headers });
      expect(unreadOnly.json().notifications).toHaveLength(0);
      expect(unreadOnly.json().unreadCount).toBe(0);
    });

    it('marks every operator notification read in one call', async () => {
      const token = await login(tenantA.managerEmail);
      const headers = authed(token);
      const response = await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().updated).toBe(1);
      const remaining = await app.inject({ method: 'GET', url: '/api/notifications?unread=true', headers });
      expect(remaining.json().notifications).toHaveLength(0);
      const otherTenant = await db.pool.query('SELECT read_at FROM app.notifications WHERE notification_id = $1', [
        tenantB.operatorNotificationId,
      ]);
      expect(otherTenant.rows[0]?.read_at).toBeNull();
    });

    it('registers a push token against the signed-in salesperson', async () => {
      const token = await login(tenantA.salespersonEmail);
      const response = await app.inject({
        method: 'POST',
        url: '/api/devices',
        headers: authed(token),
        payload: { platform: 'ios', token: 'ExponentPushToken[test-device-token]' },
      });
      expect(response.statusCode).toBe(200);
      const row = await db.pool.query('SELECT salesperson_id, active FROM app.device_tokens WHERE token = $1', [
        'ExponentPushToken[test-device-token]',
      ]);
      expect(row.rows[0]).toMatchObject({ salesperson_id: tenantA.salespersonId, active: true });
    });

    it('refuses device registration for a user with no salesperson record', async () => {
      const token = await login(tenantA.managerEmail);
      const response = await app.inject({
        method: 'POST',
        url: '/api/devices',
        headers: authed(token),
        payload: { platform: 'web', token: 'manager-device-token' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('realtime stream', () => {
    async function waitForEvent(
      received: import('../src/services/dashboard/stream-service.js').DashboardEvent[],
      predicate: (event: import('../src/services/dashboard/stream-service.js').DashboardEvent) => boolean,
      timeoutMs = 5_000,
    ): Promise<import('../src/services/dashboard/stream-service.js').DashboardEvent | null> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = received.find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    }

    it('delivers lead, message and notification events only to the owning client', async () => {
      const streamModule = await import('../src/services/dashboard/stream-service.js');
      const typesModule = await import('../src/services/dashboard/types.js');
      const sessions = await import('../src/services/dashboard/session-service.js');
      const service = new sessions.DashboardSessionService();
      const login = await service.login({
        email: tenantA.managerEmail,
        password: PASSWORD,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      });

      const received: import('../src/services/dashboard/stream-service.js').DashboardEvent[] = [];
      const bus = new streamModule.DashboardEventBus();
      const unsubscribe = await bus.subscribe({
        user: login.user,
        scope: typesModule.scopeFor(login.user),
        deliver: (event) => received.push(event),
      });

      try {
        const mine = await db.pool.query<{ lead_id: string }>(
          `INSERT INTO app.leads (client_id, contact_id, provider, provider_external_id, source, status)
           VALUES ($1, $2, 'website', 'stream_a', 'website', 'open')
           RETURNING lead_id`,
          [tenantA.clientId, tenantA.contactId],
        );
        await db.pool.query(
          `INSERT INTO app.leads (client_id, contact_id, provider, provider_external_id, source, status)
           VALUES ($1, $2, 'website', 'stream_b', 'website', 'open')`,
          [tenantB.clientId, tenantB.contactId],
        );

        const leadEvent = await waitForEvent(received, (event) => event.kind === 'lead.created');
        expect(leadEvent).not.toBeNull();
        expect(leadEvent?.clientId).toBe(tenantA.clientId);
        expect(leadEvent?.leadId).toBe(mine.rows[0]!.lead_id);

        await db.pool.query(
          `INSERT INTO app.messages (lead_id, client_id, contact_id, direction, message_text, state)
           VALUES ($1, $2, $3, 'inbound', 'حابب أعرف السعر', 'delivered')`,
          [tenantA.leadId, tenantA.clientId, tenantA.contactId],
        );
        const messageEvent = await waitForEvent(received, (event) => event.kind === 'message.created');
        expect(messageEvent?.leadId).toBe(tenantA.leadId);
        expect(messageEvent?.direction).toBe('inbound');

        // Nothing from the other tenant may ever reach this subscriber.
        expect(received.every((event) => event.clientId === tenantA.clientId)).toBe(true);
      } finally {
        unsubscribe();
        await bus.close();
      }
    }, 20_000);
  });

  describe('validation', () => {
    it('returns 400 with issues for an invalid filter', async () => {
      const token = await login(tenantA.adminEmail);
      const response = await app.inject({
        method: 'GET',
        url: '/api/leads?sort=drop_table&limit=9999',
        headers: authed(token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('validation_failed');
      expect(Array.isArray(response.json().issues)).toBe(true);
    });

    it('does not treat search input as SQL', async () => {
      const token = await login(tenantA.adminEmail);
      const response = await app.inject({
        method: 'GET',
        url: `/api/leads?q=${encodeURIComponent("' OR 1=1 --")}`,
        headers: authed(token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().leads).toHaveLength(0);
    });

    it('finds a lead by Arabic contact name and by phone fragment', async () => {
      const token = await login(tenantA.adminEmail);
      const headers = authed(token);
      const byName = await app.inject({
        method: 'GET',
        url: `/api/leads?q=${encodeURIComponent('عميل a')}`,
        headers,
      });
      const byPhone = await app.inject({ method: 'GET', url: '/api/leads?q=0001', headers });
      expect(byName.json().leads.length).toBeGreaterThan(0);
      expect(byPhone.json().leads.length).toBeGreaterThan(0);
    });
  });
});
