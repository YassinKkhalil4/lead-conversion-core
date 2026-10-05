import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DashboardSession } from '../src/services/dashboard/types.js';

type StreamRoutesModule = typeof import('../src/routes/dashboard/stream.js');
type StreamServiceModule = typeof import('../src/services/dashboard/stream-service.js');

let dashboardStreamRoutes: StreamRoutesModule['dashboardStreamRoutes'];
let DashboardEventBus: StreamServiceModule['DashboardEventBus'];

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unused';
  process.env.EDGE_SHARED_SECRET ||= 'test_shared_secret_123456';
  process.env.EDGE_INTERNAL_SECRET ||= 'test_internal_secret_123456';
  ({ dashboardStreamRoutes } = await import('../src/routes/dashboard/stream.js'));
  ({ DashboardEventBus } = await import('../src/services/dashboard/stream-service.js'));
});

const session: DashboardSession = {
  sessionId: 'session-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    userId: 'user-1',
    clientId: 'client-1',
    salespersonId: null,
    email: 'ops@example.test',
    name: 'Ops',
    role: 'admin',
    clientKey: 'client-key',
    vertical: 'real_estate',
    companyName: 'Example Realty',
    timezone: 'Africa/Cairo',
    lastLoginAt: null,
  },
};

class FakeEvents {
  unsubscribed = 0;
  failWith: Error | null = null;

  async subscribe(): Promise<() => void> {
    if (this.failWith) throw this.failWith;
    return () => {
      this.unsubscribed += 1;
    };
  }
}

class FakeSessions {
  constructor(private readonly valid: boolean) {}
  resolved: string[] = [];

  async resolve(token: string): Promise<DashboardSession | null> {
    this.resolved.push(token);
    return this.valid ? session : null;
  }
}

async function buildStreamApp(events: FakeEvents, sessions: FakeSessions): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('dashboardSession', null);
  app.addHook('preHandler', async (request) => {
    request.dashboardSession = session;
  });
  await dashboardStreamRoutes(app, { events: events as never, sessions, heartbeatMs: 20 });
  return app;
}

describe('dashboard event stream', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('ends the stream once its session no longer resolves', async () => {
    const events = new FakeEvents();
    const sessions = new FakeSessions(false);
    app = await buildStreamApp(events, sessions);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const response = await fetch(`${address}/api/stream`, {
      headers: { authorization: 'Bearer revoked-token' },
      signal: AbortSignal.timeout(2_000),
    });
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: ready');
    expect(body).toContain('event: session_expired');
    expect(sessions.resolved).toContain('revoked-token');
    expect(events.unsubscribed).toBe(1);
  });

  it('answers with an error instead of an open socket when it cannot subscribe', async () => {
    const events = new FakeEvents();
    events.failWith = new Error('connect ECONNREFUSED');
    app = await buildStreamApp(events, new FakeSessions(true));

    const response = await app.inject({ method: 'GET', url: '/api/stream' });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).not.toContain('text/event-stream');
  });
});

describe('dashboard event bus', () => {
  it('forgets a subscriber whose LISTEN connection could not be opened', async () => {
    const bus = new DashboardEventBus();

    await expect(bus.subscribe({
      user: session.user,
      scope: { clientId: 'client-1', salespersonId: null, restrictToOwnLeads: false },
      deliver: () => undefined,
    })).rejects.toThrow();

    expect(bus.subscriberCount).toBe(0);
    await bus.close();
  });
});
