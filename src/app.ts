import Fastify from 'fastify';
import { logger } from './config/logger.js';
import { healthRoutes } from './routes/health.js';
import { activeRoutes } from './routes/active.js';
import { internalRoutes } from './routes/internal.js';
import { shadowRoutes } from './routes/shadow.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 1_000_000,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  });

  await app.register(healthRoutes);
  await app.register(activeRoutes);
  await app.register(shadowRoutes);
  await app.register(internalRoutes);

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
