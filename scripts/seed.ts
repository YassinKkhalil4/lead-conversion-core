import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { closePool, pool } from '../src/db/pool.js';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { ConfigRepository } from '../src/repositories/config-repository.js';

async function main(): Promise<void> {
  const existing = await pool.query(
    `SELECT config_version FROM edge_config_snapshots
     WHERE active=true AND client_record_id IS NULL LIMIT 1`,
  );
  if (existing.rows[0]) {
    logger.info({ version: existing.rows[0].config_version }, 'Active default config already exists; seed skipped');
    await closePool();
    return;
  }

  const path = resolve(process.cwd(), getEnv().SEED_CONFIG_PATH);
  const raw = JSON.parse(await readFile(path, 'utf8')) as CompileInput;
  const config = compileConfig(raw);
  await new ConfigRepository().save(config);
  logger.info(
    {
      version: config.version,
      questions: config.questions.length,
      messages: Object.keys(config.messages).length,
    },
    'Seed configuration loaded',
  );
  await closePool();
}

main().catch(async (error) => {
  logger.error({ error }, 'Seed failed');
  await closePool();
  process.exitCode = 1;
});
