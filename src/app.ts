import { PassThrough } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { healthRoutes } from './routes/health.js';
import { internalRoutes } from './routes/internal.js';
import { leadIngressRoutes } from './routes/lead-ingress.js';
import { metaWebhookRoutes } from './routes/meta-webhooks.js';

function requiresRawWebhookBody(method: string, url: string): boolean {
  if (method !== 'POST') return false;
  return url.startsWith('/webhooks/meta/whatsapp') || url.startsWith('/webhooks/leads/facebook');
}

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 1_000_000,
    requestIdHeader: 'x-request-id',
  });

  app.addHook('preParsing', (request, _reply, payload, done) => {
    if (!requiresRawWebhookBody(request.method, request.url)) {
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

  await app.register(rateLimit, {
    global: false,
    max: env.PUBLIC_INGRESS_RATE_LIMIT_MAX,
    timeWindow: env.PUBLIC_INGRESS_RATE_LIMIT_WINDOW_MS,
  });

  await app.register(healthRoutes);
  await app.register(internalRoutes);
  await app.register(leadIngressRoutes);
  await app.register(metaWebhookRoutes);

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
