import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIGRATION_LOCK_NAME = 'lead_conversion_core_migrations';

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function assertAppliedChecksum(input: {
  migrationName: string;
  storedChecksum: string | null | undefined;
  currentChecksum: string;
}): 'valid' | 'needs_backfill' {
  if (!input.storedChecksum) return 'needs_backfill';
  if (input.storedChecksum !== input.currentChecksum) {
    throw new Error(`Applied migration checksum mismatch: ${input.migrationName}`);
  }
  return 'valid';
}

export function parseArgs(argv: string[]): void {
  for (const arg of argv) {
    if (/[\u0000-\u001f\u007f]/.test(arg)) throw new Error('Invalid migrate argument');
    throw new Error('Unknown migrate argument');
  }
}

export async function runMigrations(): Promise<void> {
  const [{ pool, closePool }, { logger }] = await Promise.all([
    import('../src/db/pool.js'),
    import('../src/config/logger.js'),
  ]);
  const migrationDir = resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationDir)).filter((file: string) => file.endsWith('.sql')).sort();

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS edge_schema_migrations (
        migration_name text PRIMARY KEY,
        checksum_sha256 text,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      ALTER TABLE edge_schema_migrations
        ADD COLUMN IF NOT EXISTS checksum_sha256 text
    `);

    for (const file of files) {
      const sql = await readFile(resolve(migrationDir, file), 'utf8');
      const checksum = checksumSql(sql);
      const applied = await client.query<{ checksum_sha256: string | null }>(
        'SELECT checksum_sha256 FROM edge_schema_migrations WHERE migration_name = $1',
        [file],
      );
      if (applied.rows[0]) {
        const status = assertAppliedChecksum({
          migrationName: file,
          storedChecksum: applied.rows[0].checksum_sha256,
          currentChecksum: checksum,
        });
        if (status === 'needs_backfill') {
          await client.query(
            'UPDATE edge_schema_migrations SET checksum_sha256=$2 WHERE migration_name=$1',
            [file, checksum],
          );
          logger.warn({ migration: file }, 'Backfilled missing migration checksum');
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO edge_schema_migrations (migration_name, checksum_sha256) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
        logger.info({ migration: file }, 'Applied migration');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]).catch((error: unknown) => {
        logger.error({ error }, 'Failed to release migration advisory lock');
      });
    }
    client.release();
    await closePool();
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  parseArgs(argv);
  await runMigrations();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
  });
}
