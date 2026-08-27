import { describe, expect, it, vi } from 'vitest';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://127.0.0.1:1/disabled_waitlist_test',
  EDGE_SHARED_SECRET: 'test_shared_secret_123456',
  EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
  RUNTIME_WORKER_ENABLED: 'false',
  META_STATUS_PROCESSOR_ENABLED: 'false',
  DIRECT_META_WEBHOOK_ENABLED: 'false',
  DIRECT_LEAD_INGRESS_ENABLED: 'false',
  META_APP_SECRET: 'test_meta_app_secret_123456',
  META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token_123456',
};

async function buildAppWithEnv(overrides: Record<string, string> = {}) {
  vi.resetModules();
  Object.assign(process.env, baseEnv, overrides);
  const { buildApp } = await import('../src/app.js');
  return buildApp();
}

describe('waitlist route gating', () => {
  it('fails closed with 503 until WAITLIST_SIGNUP_ENABLED is true', async () => {
    const app = await buildAppWithEnv({ WAITLIST_SIGNUP_ENABLED: 'false' });
    const response = await app.inject({
      method: 'POST',
      url: '/public/waitlist',
      payload: { email: 'someone@example.com' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'waitlist_signup_disabled' });
    await app.close();
    vi.resetModules();
  });

  it('validates before touching the database', async () => {
    // DATABASE_URL points at a dead port, so a 400 here proves rejection
    // happened at the schema and never reached the service.
    const app = await buildAppWithEnv({ WAITLIST_SIGNUP_ENABLED: 'true' });
    const response = await app.inject({
      method: 'POST',
      url: '/public/waitlist',
      payload: { email: 'nope' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_waitlist_submission');
    await app.close();
    vi.resetModules();
  });

  it('rejects unknown fields rather than silently dropping them', async () => {
    const app = await buildAppWithEnv({ WAITLIST_SIGNUP_ENABLED: 'true' });
    const response = await app.inject({
      method: 'POST',
      url: '/public/waitlist',
      payload: { email: 'someone@example.com', isAdmin: true },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
    vi.resetModules();
  });
});

/**
 * The waitlist path is proxied kadensio.com -> API. These lock in which address
 * `trustProxy: '127.0.0.1'` actually resolves, because the answer depends on
 * whether every hop in front of the API is loopback.
 */
describe('client IP resolution behind Caddy', () => {
  async function resolveIp(input: {
    forwardedFor: string;
    remoteAddress: string;
  }): Promise<string> {
    const app = await buildAppWithEnv({ WAITLIST_SIGNUP_ENABLED: 'true' });
    let seen = '';
    app.get('/__ip_probe', async (request) => {
      seen = request.ip;
      return { ok: true };
    });
    await app.inject({
      method: 'GET',
      url: '/__ip_probe',
      headers: { 'x-forwarded-for': input.forwardedFor },
      remoteAddress: input.remoteAddress,
    });
    await app.close();
    vi.resetModules();
    return seen;
  }

  it('resolves the browser address for a single loopback hop', async () => {
    const ip = await resolveIp({
      forwardedFor: '203.0.113.9',
      remoteAddress: '127.0.0.1',
    });
    expect(ip).toBe('203.0.113.9');
  });

  it('resolves the browser address when both proxy hops are loopback', async () => {
    // kadensio.com -> app.kadensio.com -> API, with the first hop proxying over
    // loopback rather than back out through the public name. This is the
    // deployment the waitlist path requires.
    const ip = await resolveIp({
      forwardedFor: '203.0.113.9, 127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(ip).toBe('203.0.113.9');
  });

  it('resolves the intermediate hop, not the browser, if a hop leaves the box', async () => {
    // Documents the failure mode rather than asserting it is acceptable: when
    // kadensio.com proxies out to https://app.kadensio.com over the public
    // internet, the returning hop is a public address, is therefore untrusted,
    // and becomes request.ip. Every visitor would then share one rate limit
    // bucket. The Caddy block must keep both hops on loopback.
    const ip = await resolveIp({
      forwardedFor: '203.0.113.9, 198.51.100.5',
      remoteAddress: '127.0.0.1',
    });
    expect(ip).toBe('198.51.100.5');
    expect(ip).not.toBe('203.0.113.9');
  });

  it('ignores a forwarded header from an untrusted direct caller', async () => {
    // Anything that reaches the port from a non-loopback address cannot spoof
    // its IP by setting the header itself.
    const ip = await resolveIp({
      forwardedFor: '203.0.113.9',
      remoteAddress: '198.51.100.200',
    });
    expect(ip).toBe('198.51.100.200');
  });
});

/**
 * Consequence of setting trustProxy: the in-memory limiter keys on request.ip,
 * so the existing public-ingress cap changes from one shared bucket to one
 * bucket per client. The configured max and window are untouched.
 */
describe('public ingress rate limit keying', () => {
  it('gives each client its own bucket once the proxy is trusted', async () => {
    const app = await buildAppWithEnv({
      WAITLIST_SIGNUP_ENABLED: 'true',
      PUBLIC_INGRESS_RATE_LIMIT_MAX: '2',
      PUBLIC_INGRESS_RATE_LIMIT_WINDOW_MS: '60000',
    });
    const hit = (ip: string) => app.inject({
      method: 'POST',
      url: '/public/waitlist',
      payload: { email: 'nope' },
      headers: { 'x-forwarded-for': ip },
      remoteAddress: '127.0.0.1',
    });

    // Payloads are invalid on purpose: 400 proves the request was admitted by
    // the limiter, without needing a database.
    expect((await hit('203.0.113.1')).statusCode).toBe(400);
    expect((await hit('203.0.113.1')).statusCode).toBe(400);
    expect((await hit('203.0.113.1')).statusCode).toBe(429);

    // A different client is unaffected by the first one exhausting its cap.
    expect((await hit('203.0.113.2')).statusCode).toBe(400);

    await app.close();
    vi.resetModules();
  });
});

describe('waitlist outbox command routing', () => {
  it('does not classify the waitlist command as a notification or messaging command', async () => {
    const { isWaitlistCommandType } = await import('../src/worker/waitlist-outbox-dispatcher.js');
    const { isNotificationCommandType } = await import('../src/worker/notification-outbox-dispatcher.js');

    expect(isWaitlistCommandType('waitlist.signup_notification')).toBe(true);
    expect(isNotificationCommandType('waitlist.signup_notification')).toBe(false);
    expect(isWaitlistCommandType('whatsapp.send_message')).toBe(false);
    expect(isWaitlistCommandType('salesperson.lead_assignment_notification')).toBe(false);
  });

  it('is refused by the messaging dispatcher, so falling through would be a bug', async () => {
    const { MessagingOutboxDispatcher } = await import('../src/worker/messaging-outbox-dispatcher.js');
    const meta = {
      send: async () => {
        throw new Error('messaging dispatcher must never send a waitlist command');
      },
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: meta as never });
    const result = await dispatcher.dispatch({
      outboxCommandId: '00000000-0000-4000-8000-000000000001',
      commandType: 'waitlist.signup_notification',
      destination: 'operator',
      idempotencyKey: 'waitlist:test:1',
      attemptCount: 0,
      payload: { waitlistSignupId: '00000000-0000-4000-8000-000000000002', source: 'kadensio_landing' },
    });
    expect(result).toEqual({
      outcome: 'permanently_failed',
      error: 'unsupported_outbox_command:waitlist.signup_notification',
    });
  });

  it('is handled by its own dispatcher and drains the outbox', async () => {
    const { WaitlistOutboxDispatcher } = await import('../src/worker/waitlist-outbox-dispatcher.js');
    const result = await new WaitlistOutboxDispatcher().dispatch({
      outboxCommandId: '00000000-0000-4000-8000-000000000003',
      commandType: 'waitlist.signup_notification',
      destination: 'operator',
      idempotencyKey: 'waitlist:test:2',
      attemptCount: 0,
      payload: {
        waitlistSignupId: '00000000-0000-4000-8000-000000000004',
        source: 'kadensio_landing',
        repeat: false,
        submissionCount: 1,
      },
    });
    expect(result.outcome).toBe('delivered');
  });

  it('permanently fails a malformed payload instead of retrying forever', async () => {
    const { WaitlistOutboxDispatcher } = await import('../src/worker/waitlist-outbox-dispatcher.js');
    const result = await new WaitlistOutboxDispatcher().dispatch({
      outboxCommandId: '00000000-0000-4000-8000-000000000005',
      commandType: 'waitlist.signup_notification',
      destination: 'operator',
      idempotencyKey: 'waitlist:test:3',
      attemptCount: 0,
      payload: { waitlistSignupId: 'not-a-uuid', source: '' },
    });
    expect(result.outcome).toBe('permanently_failed');
  });
});
