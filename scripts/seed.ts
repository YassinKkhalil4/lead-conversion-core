import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { closePool, pool } from '../src/db/pool.js';
import { VersionedConfigService } from '../src/configuration/versioned-config-service.js';

export function parseArgs(argv: string[]): void {
  for (const arg of argv) {
    if (/[\u0000-\u001f\u007f]/.test(arg)) throw new Error('Invalid seed argument');
    throw new Error('Unknown seed argument');
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  parseArgs(argv);
  const existing = await pool.query(
    `SELECT v.version_key, v.configuration_version_id
     FROM configuration.active_versions a
     JOIN configuration.versions v USING (configuration_version_id)
     WHERE a.scope_key='default'
     LIMIT 1`,
  );
  if (existing.rows[0]) {
    logger.info(
      {
        version: existing.rows[0].version_key,
        configurationVersionId: existing.rows[0].configuration_version_id,
      },
      'Active default versioned config already exists; seed skipped',
    );
    return;
  }

  const sourcePath = resolve(process.cwd(), getEnv().SEED_CONFIG_PATH);
  const published = await new VersionedConfigService().publish({
    sourcePath,
    clientRecordId: null,
    publishedBy: 'seed',
  });
  logger.info(
    {
      version: published.versionKey,
      configurationVersionId: published.configurationVersionId,
      activeScopeKey: published.activeScopeKey,
    },
    'Seed configuration published',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
    .catch((error) => {
      logger.error({ error }, 'Seed failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
