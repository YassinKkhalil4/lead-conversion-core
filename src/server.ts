import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';

const env = getEnv();
const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await app.close();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: env.EDGE_HOST, port: env.EDGE_PORT });
  logger.info({ host: env.EDGE_HOST, port: env.EDGE_PORT, mode: env.EDGE_MODE }, 'Conversation Edge started');
} catch (error) {
  logger.error({ error }, 'Failed to start Conversation Edge');
  await closePool();
  process.exit(1);
}
