import { afterEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://127.0.0.1:1/disabled_ingress_test',
  EDGE_SHARED_SECRET: 'test_shared_secret_123456',
  EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
  META_APP_SECRET: 'test_meta_app_secret_123456',
  META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token_123456',
};

async function buildAppWithEnv(overrides: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, baseEnv, overrides);
  const { buildApp } = await import('../src/app.js');
  return buildApp();
}

describe('direct ingress route gates', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('requires explicit direct-ingress enablement while n8n compatibility remains separately available', async () => {
    const app = await buildAppWithEnv({
      DIRECT_META_WEBHOOK_ENABLED: 'false',
      DIRECT_LEAD_INGRESS_ENABLED: 'false',
      N8N_COMPAT_ROUTES_ENABLED: 'true',
    });
    try {
      const meta = await app.inject({
        method: 'GET',
        url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=test_meta_verify_token_123456&hub.challenge=challenge-ok',
      });
      expect(meta.statusCode).toBe(503);
      expect(meta.json()).toEqual({ ok: false, error: 'direct_meta_webhook_disabled' });

      const lead = await app.inject({
        method: 'POST',
        url: '/webhooks/leads/website',
        headers: { 'x-edge-secret': 'test_shared_secret_123456' },
        payload: { eventId: 'evt-disabled', phone: '+201000000001' },
      });
      expect(lead.statusCode).toBe(503);
      expect(lead.json()).toEqual({ ok: false, error: 'direct_lead_ingress_disabled' });

      const compat = await app.inject({
        method: 'POST',
        url: '/compat/n8n/messages/whatsapp/inbound',
        headers: { 'x-internal-secret': 'test_internal_secret_123456' },
        payload: {},
      });
      expect(compat.statusCode).toBe(400);
      expect(compat.json()).toMatchObject({ ok: false });
    } finally {
      await app.close();
    }
  });

  it('allows the direct Meta challenge only when explicitly enabled', async () => {
    const app = await buildAppWithEnv({
      DIRECT_META_WEBHOOK_ENABLED: 'true',
      DIRECT_LEAD_INGRESS_ENABLED: 'false',
      N8N_COMPAT_ROUTES_ENABLED: 'false',
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=test_meta_verify_token_123456&hub.challenge=challenge-ok',
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('challenge-ok');
    } finally {
      await app.close();
    }
  });
});
