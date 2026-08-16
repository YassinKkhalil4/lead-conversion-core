import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardEvent, DashboardEventBus } from '../../services/dashboard/stream-service.js';
import { scopeFor } from '../../services/dashboard/types.js';
import { requireSession } from './context.js';

const HEARTBEAT_MS = 25_000;
const CLIENT_RETRY_MS = 3_000;

export async function dashboardStreamRoutes(
  app: FastifyInstance,
  deps: { events: DashboardEventBus },
): Promise<void> {
  app.get('/api/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request);
    const scope = scopeFor(session.user);

    // Take ownership of the socket: Fastify must not serialise or close it.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Caddy and other reverse proxies must not buffer an SSE body.
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`retry: ${CLIENT_RETRY_MS}\n\n`);
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ clientId: scope.clientId })}\n\n`);

    const write = (event: DashboardEvent): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = await deps.events.subscribe({ user: session.user, scope, deliver: write });

    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`: keepalive ${Date.now()}\n\n`);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    request.raw.on('close', close);
    request.raw.on('error', close);
  });
}
