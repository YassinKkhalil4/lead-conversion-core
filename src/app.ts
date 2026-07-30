import { PassThrough } from 'node:stream';
import Fastify from 'fastify';
import { logger } from './config/logger.js';
import { healthRoutes } from './routes/health.js';
import { activeRoutes } from './routes/active.js';
import { internalRoutes } from './routes/internal.js';
import { metaWebhookRoutes } from './routes/meta-webhooks.js';
import { n8nCompatRoutes } from './routes/n8n-compat.js';
import { shadowRoutes } from './routes/shadow.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 1_000_000,
    requestIdHeader: 'x-request-id',
  });

  app.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.method !== 'POST' || !request.url.startsWith('/webhooks/meta/whatsapp')) {
      done(null, payload);
      return;
    }
    const replay = new PassThrough();
    const chunks: Buffer[] = [];
    payload.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      replay.write(buffer);
    });
    payload.on('end', () => {
      Object.assign(request, { rawBody: Buffer.concat(chunks) });
      replay.end();
    });
    payload.on('error', (error: Error) => replay.destroy(error));
    done(null, replay);
  });

  await app.register(healthRoutes);
  await app.register(activeRoutes);
  await app.register(shadowRoutes);
  await app.register(internalRoutes);
  await app.register(metaWebhookRoutes);
  await app.register(n8nCompatRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'Request failed');

    const normalizedError =
      error instanceof Error
        ? error
        : new Error(String(error));

    const statusCode = Number(
      (error as { statusCode?: number }).statusCode || 500,
    );

    reply.code(statusCode).send({
      ok: false,
      error:
        statusCode >= 500
          ? 'internal_error'
          : normalizedError.message,
    });
  });

  return app;
}
