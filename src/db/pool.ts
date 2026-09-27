import pg from 'pg';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

const { Pool } = pg;

/** Anything that can run a query: the pool itself, or a client inside a transaction. */
export type Db = pg.Pool | pg.PoolClient;

export const pool = new Pool({
  connectionString: getEnv().DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'conversation-edge',
});

pool.on('error', (error: Error) => {
  logger.error({ error }, 'Unexpected PostgreSQL pool error');
});

export async function closePool(): Promise<void> {
  await pool.end();
}
