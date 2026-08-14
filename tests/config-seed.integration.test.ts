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

describePg('seeded versioned configuration with real PostgreSQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-config-seed-test.'));
  const dataDir = join(root, 'data');
  const socketDir = root;
  const port = 58_500 + Math.floor(Math.random() * 1000);
  const dbName = 'lead_core_config_seed_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  let db: typeof import('../src/db/pool.js');

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${socketDir}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      EDGE_SHARED_SECRET: 'test_shared_secret_123456',
      EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
      SEED_CONFIG_PATH: 'config/seed-real-estate.json',
    };
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });

    vi.resetModules();
    process.env.DATABASE_URL = databaseUrl;
    process.env.EDGE_SHARED_SECRET = env.EDGE_SHARED_SECRET;
    process.env.EDGE_INTERNAL_SECRET = env.EDGE_INTERNAL_SECRET;
    process.env.SEED_CONFIG_PATH = env.SEED_CONFIG_PATH;
    db = await import('../src/db/pool.js');
  }, 30_000);

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

  it('seeds, publishes, activates, and reads runtime config from configuration tables', async () => {
    const seed = await import('../scripts/seed.js');
    await seed.main([]);

    const { VersionedConfigService } = await import('../src/configuration/versioned-config-service.js');
    const { ConfigRepository } = await import('../src/repositories/config-repository.js');
    const service = new VersionedConfigService();
    const published = await service.publish({
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId: null,
      publishedBy: 'integration-test',
    });
    const activated = await service.activateVersion({
      versionKey: published.versionKey,
      clientRecordId: null,
      activatedBy: 'integration-test',
    });
    const runtimeSnapshot = await new ConfigRepository().getActiveSnapshot('');

    expect(activated.scopeKey).toBe('default');
    expect(runtimeSnapshot.source).toBe('versioned');
    expect(runtimeSnapshot.versionKey).toBe(published.versionKey);
    expect(runtimeSnapshot.configurationVersionId).toBe(activated.configurationVersionId);
    expect(runtimeSnapshot.config.questions.length).toBeGreaterThan(0);
    expect(runtimeSnapshot.config.messages.language_selection).toBeDefined();
  });
});
