import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { metricsRegistry } from '../config/metrics.js';
import { pool } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  app.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await pool.query<{
        migration_name: string;
        applied_at: Date;
      }>(
        `SELECT migration_name, applied_at
         FROM edge_schema_migrations
         ORDER BY migration_name DESC
         LIMIT 1`,
      );
      return {
        ok: true,
        database: 'ready',
        migrations: {
          latest: result.rows[0]?.migration_name || null,
          latestAppliedAt: result.rows[0]?.applied_at || null,
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
