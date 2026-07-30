import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';
import { metricsRegistry } from '../config/metrics.js';
import { pool } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  app.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const expectedMigrations = (await readdir(resolve(process.cwd(), 'migrations')))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const result = await pool.query<{
        migration_name: string;
        applied_at: Date;
      }>(
        `SELECT migration_name, applied_at
         FROM edge_schema_migrations
         ORDER BY migration_name`,
      );
      const applied = new Set(result.rows.map((row) => row.migration_name));
      const missing = expectedMigrations.filter((migration) => !applied.has(migration));
      const latest = result.rows[result.rows.length - 1] || null;
      const worker = await pool.query<{
        worker_name: string;
        heartbeat_at: Date;
      }>(
        `SELECT worker_name, heartbeat_at
         FROM runtime.worker_heartbeats
         WHERE worker_kind=$1
         ORDER BY heartbeat_at DESC
         LIMIT 1`,
        [getEnv().WORKER_KIND],
      ).catch(() => ({ rows: [] as Array<{ worker_name: string; heartbeat_at: Date }> }));
      const heartbeat = worker.rows[0] || null;
      const heartbeatAgeMs = heartbeat ? Date.now() - new Date(heartbeat.heartbeat_at).getTime() : null;
      const workerRequired = getEnv().OUTBOX_WORKER_ENABLED;
      const workerReady = !workerRequired || (heartbeatAgeMs !== null && heartbeatAgeMs <= 120_000);
      if (missing.length > 0 || !workerReady) reply.code(503);
      return {
        ok: missing.length === 0 && workerReady,
        database: 'ready',
        migrations: {
          expected: expectedMigrations.length,
          applied: result.rows.length,
          missing,
          latest: latest?.migration_name || null,
          latestAppliedAt: latest?.applied_at || null,
        },
        workerHeartbeat: {
          required: workerRequired,
          latestWorkerName: heartbeat?.worker_name || null,
          latestHeartbeatAt: heartbeat?.heartbeat_at || null,
          heartbeatAgeMs,
          ready: workerReady,
        },
      };
    } catch (error) {
      reply.code(503);
      return { ok: false, database: 'unavailable', error: String(error) };
    }
  });

  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });
}
