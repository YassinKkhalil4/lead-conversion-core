import { PassThrough } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { dashboardRoutes } from './routes/dashboard/index.js';
import { healthRoutes } from './routes/health.js';
import { internalRoutes } from './routes/internal.js';
import { leadIngressRoutes } from './routes/lead-ingress.js';
import { metaWebhookRoutes } from './routes/meta-webhooks.js';
import { waitlistRoutes } from './routes/waitlist.js';

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
    // Caddy is the only thing that can reach the API's loopback bind, so the
    // trusted set is exactly loopback. Without this `request.ip` is Caddy's
    // address for every public request and every IP-keyed limit collapses into
    // a single global counter.
    //
    // This resolves the client only when every hop in front is also loopback.
    // A proxy chain that leaves the box and comes back resolves to the
    // returning hop instead — see docs and the waitlist tests.
    trustProxy: '127.0.0.1',
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
  await app.register(waitlistRoutes);
  if (env.DASHBOARD_API_ENABLED) {
    await app.register(dashboardRoutes);
  }

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
