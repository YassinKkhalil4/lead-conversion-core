import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { OutboxWorker } from './worker/outbox-worker.js';
import { RuntimeWorker } from './worker/runtime-worker.js';

const env = getEnv();
const worker = env.WORKER_KIND === 'runtime' ? new RuntimeWorker() : new OutboxWorker();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping outbox worker');
  worker.stop();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.run().catch(async (error) => {
  logger.error({ error }, 'Outbox worker crashed');
  await closePool();
  process.exit(1);
});
