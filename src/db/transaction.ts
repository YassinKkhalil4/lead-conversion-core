import type { PoolClient } from 'pg';
import { pool } from './pool.js';

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Rolls back without throwing. Returns the failure instead, so the caller can
 * keep the error that caused the rollback and still destroy the connection:
 * a client whose ROLLBACK failed is in an unknown transaction state and must
 * not go back to the pool.
 */
export async function rollbackQuietly(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (error) {
    return asError(error);
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let brokenConnection: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    brokenConnection = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(brokenConnection);
  }
}
