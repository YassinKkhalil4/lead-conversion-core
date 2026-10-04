import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeEqual } from '../src/routes/auth.js';

const VERIFY_TOKEN = 'test_meta_verify_token_123456';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://127.0.0.1:1/meta_verify_test',
  EDGE_SHARED_SECRET: 'test_shared_secret_123456',
  EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
  RUNTIME_WORKER_ENABLED: 'true',
  META_STATUS_PROCESSOR_ENABLED: 'true',
  DIRECT_META_WEBHOOK_ENABLED: 'true',
  DIRECT_LEAD_INGRESS_ENABLED: 'false',
  META_APP_SECRET: 'test_meta_app_secret_123456',
  META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
};

async function appWithEnv(overrides: Record<string, string> = {}) {
  vi.resetModules();
  Object.assign(process.env, baseEnv, overrides);
  const { buildApp } = await import('../src/app.js');
  return buildApp();
}

describe('safeEqual', () => {
  it('matches only identical strings', () => {
    expect(safeEqual('secret-value', 'secret-value')).toBe(true);
    expect(safeEqual('secret-value', 'secret-valuf')).toBe(false);
    expect(safeEqual('secret', 'secret-value')).toBe(false);
    expect(safeEqual('', 'secret-value')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('Meta webhook verification handshake', () => {
  afterEach(() => {
    vi.resetModules();
  });

  async function challenge(query: string, overrides: Record<string, string> = {}) {
    const app = await appWithEnv(overrides);
    try {
      return await app.inject({ method: 'GET', url: `/webhooks/meta/whatsapp${query}` });
    } finally {
      await app.close();
    }
  }

  it('echoes the challenge for the right mode and token', async () => {
    const response = await challenge(`?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('abc123');
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it.each([
    ['a wrong token of the same length', `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN.replace(/.$/, 'X')}&hub.challenge=c`],
    ['a wrong token of another length', '?hub.mode=subscribe&hub.verify_token=short&hub.challenge=c'],
    ['a missing token', '?hub.mode=subscribe&hub.challenge=c'],
    ['an empty token', '?hub.mode=subscribe&hub.verify_token=&hub.challenge=c'],
    ['the wrong mode', `?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=c`],
    ['no mode', `?hub.verify_token=${VERIFY_TOKEN}&hub.challenge=c`],
    ['no query at all', ''],
  ])('refuses %s', async (_label, query) => {
    const response = await challenge(query);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: 'invalid_meta_webhook_challenge' });
    expect(response.body).not.toContain(VERIFY_TOKEN);
  });

  it('is closed with 503 while the direct webhook is disabled', async () => {
    const response = await challenge(
      `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=c`,
      { DIRECT_META_WEBHOOK_ENABLED: 'false' },
    );
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'direct_meta_webhook_disabled' });
  });
});
