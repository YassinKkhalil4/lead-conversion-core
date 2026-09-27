import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardEvent, DashboardEventBus } from '../../services/dashboard/stream-service.js';
import { type DashboardSession, scopeFor } from '../../services/dashboard/types.js';
import { readBearerToken, requireSession } from './context.js';

const HEARTBEAT_MS = 25_000;
const CLIENT_RETRY_MS = 3_000;

interface SessionResolver {
  resolve(token: string): Promise<DashboardSession | null>;
}

export async function dashboardStreamRoutes(
  app: FastifyInstance,
  deps: {
    events: Pick<DashboardEventBus, 'subscribe'>;
    sessions: SessionResolver;
    heartbeatMs?: number;
  },
): Promise<void> {
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;

  app.get('/api/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request);
    const token = readBearerToken(request);
    const scope = scopeFor(session.user);

    let open = false;
    const write = (event: DashboardEvent): void => {
      if (!open || reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Subscribe before taking over the socket, so a failure to LISTEN is an
    // ordinary error response rather than a hijacked connection left open.
    const unsubscribe = await deps.events.subscribe({ user: session.user, scope, deliver: write });

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
    open = true;

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    // A stream can stay open for days. Re-check the session on every
    // heartbeat so logging out, a password change, or deactivating the user
    // also cuts off the events they were receiving.
    const heartbeat = setInterval(() => {
      void deps.sessions.resolve(token).then(
        (current) => {
          if (closed || reply.raw.writableEnded) return;
          if (!current) {
            reply.raw.write('event: session_expired\ndata: {}\n\n');
            close();
            return;
          }
          reply.raw.write(`: keepalive ${Date.now()}\n\n`);
        },
        (error: unknown) => {
          // A database blip is not a logout; keep the stream and try again.
          request.log.warn({ error }, 'Dashboard stream session check failed');
        },
      );
    }, heartbeatMs);
    heartbeat.unref?.();

    request.raw.on('close', close);
    request.raw.on('error', close);
  });
}
