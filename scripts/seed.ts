import { resolve } from 'node:path';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { closePool, pool } from '../src/db/pool.js';
import { VersionedConfigService } from '../src/configuration/versioned-config-service.js';

async function main(): Promise<void> {
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
    await closePool();
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
  await closePool();
}

main().catch(async (error) => {
  logger.error({ error }, 'Seed failed');
  await closePool();
  process.exitCode = 1;
});
