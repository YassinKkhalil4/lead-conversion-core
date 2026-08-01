import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

describePg('readiness worker requirements with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-ready-test.'));
  const dataDir = join(root, 'data');
  const socketDir = root;
  const port = 57_500 + Math.floor(Math.random() * 1000);
  const dbName = 'lead_core_ready_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  let db: typeof import('../src/db/pool.js');
  let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>> | undefined;

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
    process.env.OUTBOX_WORKER_ENABLED = 'false';
    process.env.RUNTIME_WORKER_ENABLED = 'true';
    process.env.WORKER_KIND = 'runtime';
    db = await import('../src/db/pool.js');
    const appModule = await import('../src/app.js');
    app = await appModule.buildApp();
  }, 30_000);

  afterAll(async () => {
    try {
      if (app) await app.close();
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

  it('fails readiness when runtime worker is required but missing, then passes after heartbeat', async () => {
    if (!app) throw new Error('app_not_initialized');
    const missing = await app.inject({ method: 'GET', url: '/ready' });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({
      ok: false,
      workerHeartbeats: [
        { workerKind: 'outbox', required: false, ready: true },
        { workerKind: 'runtime', required: true, ready: false },
      ],
    });

    await db.pool.query(
      `INSERT INTO runtime.worker_heartbeats
        (worker_name, worker_kind, process_id, started_at, heartbeat_at, metadata_json)
       VALUES ('runtime-ready-test-disabled', 'runtime', 1, now(), now(), '{"enabled":false,"jobProcessorConfigured":true}'::jsonb)`,
    );
    const disabledHeartbeat = await app.inject({ method: 'GET', url: '/ready' });
    expect(disabledHeartbeat.statusCode).toBe(503);
    expect(disabledHeartbeat.json()).toMatchObject({
      ok: false,
      workerHeartbeats: [
        { workerKind: 'outbox', required: false, ready: true },
        {
          workerKind: 'runtime',
          required: true,
          ready: false,
          latestWorkerName: 'runtime-ready-test-disabled',
          operational: false,
        },
      ],
    });

    await db.pool.query(
      `INSERT INTO runtime.worker_heartbeats
        (worker_name, worker_kind, process_id, started_at, heartbeat_at, metadata_json)
       VALUES ('runtime-ready-test', 'runtime', 1, now(), now(), '{"enabled":true,"jobProcessorConfigured":true}'::jsonb)`,
    );
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      ok: true,
      workerHeartbeats: [
        { workerKind: 'outbox', required: false, ready: true },
        { workerKind: 'runtime', required: true, ready: true, latestWorkerName: 'runtime-ready-test', operational: true },
      ],
    });
  });
});
