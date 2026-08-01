import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describePg('airtable importer with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-import-test.'));
  const dataDir = join(root, 'data');
  const socketDir = root;
  const port = 55_500 + Math.floor(Math.random() * 1000);
  const dbName = 'lead_core_import_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    EDGE_SHARED_SECRET: 'test_shared_secret_123456',
    EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
  };

  beforeAll(() => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${socketDir}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
  }, 30_000);

  afterAll(() => {
    try {
      execFileSync('pg_ctl', ['-D', dataDir, 'stop'], { stdio: 'ignore' });
    } catch {
      // The test has already failed if PostgreSQL cannot stop; cleanup still continues.
    }
    rmSync(root, { recursive: true, force: true });
  });

  function runScript(script: string, args: string[] = []): void {
    execFileSync('npm', ['run', script, '--', ...args], { env, stdio: 'ignore' });
  }

  function psqlScalar(sql: string): string {
    return execFileSync('psql', [databaseUrl, '-tAc', sql], { encoding: 'utf8' }).trim();
  }

  it('applies sample records idempotently', () => {
    runScript('import:airtable', ['--input=tests/fixtures/airtable-export', '--apply']);
    runScript('import:airtable', ['--input=tests/fixtures/airtable-export', '--apply']);
    expect(psqlScalar('SELECT count(*) FROM app.clients')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.contacts')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.leads')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.qualification_sessions')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.score_runs')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.messages')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.followups')).toBe('1');
    expect(psqlScalar('SELECT count(*) FROM app.appointments')).toBe('1');
    expect(psqlScalar("SELECT count(*) FROM migration.entity_map WHERE source_table='Events' AND target_table='audit.events'")).toBe('1');
    expect(psqlScalar("SELECT count(*) FROM audit.events WHERE event_type='lead_contacted' AND actor_type='migration'")).toBe('1');
    expect(psqlScalar("SELECT payload_json->'payload'->>'access_token' FROM audit.events WHERE event_type='lead_contacted'")).toBe('[REDACTED]');
    runScript('reconcile:airtable', ['--record-results']);
    expect(psqlScalar("SELECT status FROM migration.reconciliation_results WHERE check_key='events_mapped' ORDER BY created_at DESC LIMIT 1")).toBe('pass');
    expect(psqlScalar("SELECT status FROM migration.reconciliation_results WHERE check_key='lead_status_distribution' ORDER BY created_at DESC LIMIT 1")).toBe('pass');
    expect(psqlScalar("SELECT details_json->'expected'->>'New' FROM migration.reconciliation_results WHERE check_key='lead_status_distribution' ORDER BY created_at DESC LIMIT 1")).toBe('1');
    expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='active_leads_count' ORDER BY created_at DESC LIMIT 1")).toBe('1:1');
    expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='stop_follow_up_count' ORDER BY created_at DESC LIMIT 1")).toBe('0:0');
    expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='pending_followups_count' ORDER BY created_at DESC LIMIT 1")).toBe('1:1');
    expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='open_booked_appointments_count' ORDER BY created_at DESC LIMIT 1")).toBe('1:1');
    expect(psqlScalar("SELECT actual_count FROM migration.reconciliation_results WHERE check_key='message_provider_id_uniqueness' ORDER BY created_at DESC LIMIT 1")).toBe('0');
  }, 30_000);

  it('records missing relationship rejects without creating target entities', () => {
    runScript('import:airtable', ['--input=tests/fixtures/airtable-export-missing-relationships', '--apply']);
    expect(psqlScalar("SELECT count(*) FROM migration.rejected_records WHERE reason='missing_mapped_client'")).toBe('1');
    expect(psqlScalar("SELECT count(*) FROM migration.rejected_records WHERE reason='missing_mapped_project'")).toBe('1');
    expect(psqlScalar("SELECT count(*) FROM migration.rejected_records WHERE reason='missing_mapped_lead' AND table_name='Events'")).toBe('1');
    expect(psqlScalar("SELECT count(*) FROM app.projects WHERE legacy_airtable_id='recPROJECTBAD'")).toBe('0');
    expect(psqlScalar("SELECT count(*) FROM app.leads WHERE legacy_airtable_id='recLEADBAD'")).toBe('0');
    expect(psqlScalar("SELECT count(*) FROM migration.entity_map WHERE source_table='Events' AND source_record_id='recEVENTBAD'")).toBe('0');
    const child = spawn('npm', ['run', 'reconcile:airtable', '--', '--record-results'], {
      env,
      stdio: 'ignore',
    });
    return new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        try {
          expect(code).not.toBe(0);
          expect(psqlScalar("SELECT status FROM migration.reconciliation_results WHERE check_key='rejected_records' ORDER BY created_at DESC LIMIT 1")).toBe('fail');
          expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='projects_mapped' ORDER BY created_at DESC LIMIT 1")).toBe('0:0');
          expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='leads_mapped' ORDER BY created_at DESC LIMIT 1")).toBe('0:0');
          expect(psqlScalar("SELECT expected_count || ':' || actual_count FROM migration.reconciliation_results WHERE check_key='events_mapped' ORDER BY created_at DESC LIMIT 1")).toBe('0:0');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }, 30_000);

  it('rolls back raw records when apply fails mid-transaction', () => {
    const before = psqlScalar('SELECT count(*) FROM migration.import_runs');
    const child = spawn('npm', ['run', 'import:airtable', '--', '--input=tests/fixtures/airtable-export-invalid-sql', '--apply'], {
      env,
      stdio: 'ignore',
    });
    return new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        try {
          expect(code).not.toBe(0);
          expect(psqlScalar('SELECT count(*) FROM migration.import_runs')).toBe(before);
          expect(psqlScalar("SELECT count(*) FROM migration.airtable_raw_records WHERE record_id='recPROJECTSQLBAD'")).toBe('0');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }, 30_000);
});
