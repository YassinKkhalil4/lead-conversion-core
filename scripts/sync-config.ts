import { logger } from '../src/config/logger.js';
import { closePool } from '../src/db/pool.js';
import { ConfigSyncService } from '../src/services/config-sync-service.js';

const clientRecordId = process.argv[2] || null;

new ConfigSyncService()
  .sync(clientRecordId)
  .then(async (config) => {
    logger.info(
      { version: config.version, clientRecordId, questions: config.questions.length },
      'Configuration synced',
    );
    await closePool();
  })
  .catch(async (error) => {
    logger.error({ error }, 'Configuration sync failed');
    await closePool();
    process.exitCode = 1;
  });
