import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedOutboxCommand } from '../src/infrastructure/runtime.js';

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

describePg('NotificationOutboxDispatcher with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-notification-test.'));
  const dataDir = join(root, 'data');
  const socketDir = root;
  const port = 59_500 + Math.floor(Math.random() * 1000);
  const dbName = 'lead_core_notification_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  let db: typeof import('../src/db/pool.js');
  let dispatcherModule: typeof import('../src/worker/notification-outbox-dispatcher.js');
  let clientId = '';
  let leadId = '';
  let salespersonId = '';
  let assignmentId = '';

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${socketDir}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
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
    db = await import('../src/db/pool.js');
    dispatcherModule = await import('../src/worker/notification-outbox-dispatcher.js');
  }, 30_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE
        app.notifications,
        app.lead_assignments,
        app.leads,
        app.contacts,
        app.salespeople,
        app.projects,
        app.clients,
        runtime.outbox_command_attempts,
        runtime.outbox_commands
      RESTART IDENTITY CASCADE
    `);
    const client = await db.pool.query<{ client_id: string }>(
      "INSERT INTO app.clients (client_key, company_name) VALUES ('notification-client', 'Notification Client') RETURNING client_id",
    );
    clientId = client.rows[0]?.client_id || '';
    const contact = await db.pool.query<{ contact_id: string }>(
      `INSERT INTO app.contacts (client_id, name, phone_e164, consent_status)
       VALUES ($1, 'Lead Contact', '+201011111111', 'opted_in')
       RETURNING contact_id`,
      [clientId],
    );
    const project = await db.pool.query<{ project_id: string }>(
      "INSERT INTO app.projects (client_id, project_name) VALUES ($1, 'Notification Project') RETURNING project_id",
      [clientId],
    );
    const salesperson = await db.pool.query<{ salesperson_id: string }>(
      `INSERT INTO app.salespeople (client_id, name, phone_e164)
       VALUES ($1, 'Sales One', '+201022222222')
       RETURNING salesperson_id`,
      [clientId],
    );
    salespersonId = salesperson.rows[0]?.salesperson_id || '';
    const lead = await db.pool.query<{ lead_id: string }>(
      `INSERT INTO app.leads
        (client_id, contact_id, project_id, provider, provider_external_id, source, source_payload_hash)
       VALUES ($1, $2, $3, 'test', 'lead-1', 'test', 'hash-1')
       RETURNING lead_id`,
      [clientId, contact.rows[0]?.contact_id, project.rows[0]?.project_id],
    );
    leadId = lead.rows[0]?.lead_id || '';
    const routingRun = await db.pool.query<{ routing_run_id: string }>(
      `INSERT INTO app.routing_runs
        (lead_id, routing_version, input_hash, outcome, selected_salesperson_id)
       VALUES ($1, 'test_v1', 'route-hash-1', 'assigned', $2)
       RETURNING routing_run_id`,
      [leadId, salespersonId],
    );
    const assignment = await db.pool.query<{ lead_assignment_id: string }>(
      `INSERT INTO app.lead_assignments (lead_id, salesperson_id, routing_version, routing_run_id, idempotency_key)
       VALUES ($1, $2, 'test_v1', $3, 'assignment-1')
       RETURNING lead_assignment_id`,
      [leadId, salespersonId, routingRun.rows[0]?.routing_run_id],
    );
    assignmentId = assignment.rows[0]?.lead_assignment_id || '';
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
      vi.resetModules();
    }
  });

  async function persistedCommand(commandType: string, payload: Record<string, unknown>): Promise<ClaimedOutboxCommand> {
    const inserted = await db.pool.query<{ outbox_command_id: string }>(
      `INSERT INTO runtime.outbox_commands (command_type, destination, idempotency_key, aggregate_key, payload_json)
       VALUES ($1, 'dashboard', $2, $3, $4::jsonb)
       RETURNING outbox_command_id`,
      [commandType, `notify:${commandType}`, leadId, JSON.stringify(payload)],
    );
    return {
      outboxCommandId: inserted.rows[0]?.outbox_command_id || '',
      commandType,
      destination: 'dashboard',
      idempotencyKey: `notify:${commandType}`,
      attemptCount: 1,
      payload,
    };
  }

  it('persists all notification command types without sending WhatsApp messages', async () => {
    const dispatcher = new dispatcherModule.NotificationOutboxDispatcher();
    const commands = [
      await persistedCommand('salesperson.lead_assignment_notification', { clientId, leadId, assignmentId, salespersonId }),
      await persistedCommand('salesperson.sla_assignment_reminder', { leadId, assignmentId, salespersonId, slaJobId: '11111111-1111-4111-8111-111111111111' }),
      await persistedCommand('operator.sla_escalation', { leadId, assignmentId, salespersonId, reason: 'assignment_not_acknowledged' }),
      await persistedCommand('operator.daily_report', { clientId, dailyReportId: '22222222-2222-4222-8222-222222222222' }),
      await persistedCommand('operator.routing_attention_required', { leadId, routingRunId: '33333333-3333-4333-8333-333333333333', reason: 'fallback_handoff' }),
    ];

    for (const command of commands) {
      await expect(dispatcher.dispatch(command)).resolves.toMatchObject({ outcome: 'delivered' });
    }

    const notifications = await db.pool.query<{ notification_type: string; recipient_type: string; priority: string }>(
      'SELECT notification_type, recipient_type, priority FROM app.notifications ORDER BY notification_type',
    );
    expect(notifications.rows).toEqual([
      { notification_type: 'operator.daily_report', recipient_type: 'operator', priority: 'normal' },
      { notification_type: 'operator.routing_attention_required', recipient_type: 'operator', priority: 'high' },
      { notification_type: 'operator.sla_escalation', recipient_type: 'operator', priority: 'high' },
      { notification_type: 'salesperson.lead_assignment_notification', recipient_type: 'salesperson', priority: 'normal' },
      { notification_type: 'salesperson.sla_assignment_reminder', recipient_type: 'salesperson', priority: 'normal' },
    ]);
  });

  it('rejects unresolvable notification payloads without creating notification rows', async () => {
    const dispatcher = new dispatcherModule.NotificationOutboxDispatcher();
    const command = await persistedCommand('operator.routing_attention_required', { reason: 'missing_relationship' });

    await expect(dispatcher.dispatch(command)).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'notification_client_id_unresolved',
    });
    expect((await db.pool.query('SELECT count(*) FROM app.notifications')).rows[0]?.count).toBe('0');
  });

  it('persists operator SLA escalations with empty assignment and salesperson ids by resolving from lead', async () => {
    const dispatcher = new dispatcherModule.NotificationOutboxDispatcher();
    const command = await persistedCommand('operator.sla_escalation', {
      leadId,
      assignmentId: '',
      salespersonId: '',
      reason: 'stale_qualified_lead',
    });

    await expect(dispatcher.dispatch(command)).resolves.toMatchObject({ outcome: 'delivered' });
    expect((await db.pool.query(
      `SELECT client_id, recipient_type, recipient_id, notification_type, payload_json
       FROM app.notifications`,
    )).rows).toEqual([
      {
        client_id: clientId,
        recipient_type: 'operator',
        recipient_id: null,
        notification_type: 'operator.sla_escalation',
        payload_json: {
          leadId,
          assignmentId: '',
          salespersonId: '',
          reason: 'stale_qualified_lead',
        },
      },
    ]);
  });

  it('fails closed when salesperson notifications have an empty salesperson id', async () => {
    const dispatcher = new dispatcherModule.NotificationOutboxDispatcher();
    const command = await persistedCommand('salesperson.sla_assignment_reminder', {
      leadId,
      assignmentId,
      salespersonId: '',
      slaJobId: '11111111-1111-4111-8111-111111111111',
    });

    await expect(dispatcher.dispatch(command)).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'notification_salesperson_id_required',
    });
    expect((await db.pool.query('SELECT count(*) FROM app.notifications')).rows[0]?.count).toBe('0');
  });
});
