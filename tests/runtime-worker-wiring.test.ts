import { describe, expect, it, vi } from 'vitest';

const baseEnv = {
  DATABASE_URL: 'postgresql://127.0.0.1:1/unused',
  EDGE_SHARED_SECRET: 'test_shared_secret_123456',
  EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
};

async function loadWiring() {
  vi.resetModules();
  Object.assign(process.env, baseEnv);
  const [{ parseEnv }, { buildRuntimeInboxWiring }] = await Promise.all([
    import('../src/config/env.js'),
    import('../src/worker/runtime-worker-wiring.js'),
  ]);
  return { parseEnv, buildRuntimeInboxWiring };
}

describe('runtime worker wiring', () => {
  it('wires direct Meta webhook processors only for Meta providers', async () => {
    const { parseEnv, buildRuntimeInboxWiring } = await loadWiring();
    const env = parseEnv({
      ...baseEnv,
      RUNTIME_WORKER_ENABLED: 'true',
      DIRECT_META_WEBHOOK_ENABLED: 'true',
      META_STATUS_PROCESSOR_ENABLED: 'true',
      META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token',
      META_APP_SECRET: 'test_meta_app_secret',
      DIRECT_LEAD_INGRESS_ENABLED: 'false',
    });

    const wiring = buildRuntimeInboxWiring(env);

    expect(wiring.metaInboxProcessor).toBeDefined();
    expect(wiring.leadIngressInboxProcessor).toBeUndefined();
    expect(wiring.inboxProviders).toEqual(['meta']);
    expect(wiring.inboxEventTypes).toEqual([
      'whatsapp.message_status',
      'whatsapp.message_received',
      'salesperson.command_received',
      'whatsapp.webhook_ignored',
    ]);
  });

  it('keeps direct lead processors gated by direct lead ingress', async () => {
    const { parseEnv, buildRuntimeInboxWiring } = await loadWiring();
    const env = parseEnv({
      ...baseEnv,
      RUNTIME_WORKER_ENABLED: 'true',
      DIRECT_LEAD_INGRESS_ENABLED: 'true',
      META_APP_SECRET: 'test_meta_app_secret',
      META_STATUS_PROCESSOR_ENABLED: 'false',
      DIRECT_META_WEBHOOK_ENABLED: 'false',
    });

    const wiring = buildRuntimeInboxWiring(env);

    expect(wiring.metaInboxProcessor).toBeUndefined();
    expect(wiring.leadIngressInboxProcessor).toBeDefined();
    expect(wiring.inboxProviders).toEqual(['website', 'facebook']);
    expect(wiring.inboxEventTypes).toEqual(['lead.created', 'leadgen.created']);
  });
});
