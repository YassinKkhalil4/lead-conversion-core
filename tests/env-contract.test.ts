import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://127.0.0.1:1/unused',
  EDGE_SHARED_SECRET: 'test_shared_secret_123456',
  EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
};

describe('environment contract', () => {
  it('keeps .env.example aligned with validated runtime variables and generator replacements', () => {
    const example = readFileSync('.env.example', 'utf8');
    const envSource = readFileSync('src/config/env.ts', 'utf8');
    const generator = readFileSync('scripts/generate-env.sh', 'utf8');

    for (const [, name] of envSource.matchAll(/^\s{2}([A-Z0-9_]+):/gm)) {
      expect(example, `${name} missing from .env.example`).toContain(`${name}=`);
    }

    for (const placeholder of [
      'EDGE_POSTGRES_PASSWORD=replace-with-secret',
      'DATABASE_URL=postgresql://lead_os_edge_app:replace-with-secret@127.0.0.1:5432/lead_os_edge',
      'EDGE_SHARED_SECRET=replace-with-at-least-16-chars',
      'EDGE_INTERNAL_SECRET=replace-with-at-least-16-chars',
    ]) {
      expect(example).toContain(placeholder);
      expect(generator).toContain(placeholder);
    }
  });

  it('allows disabled external integrations to have blank credentials', () => {
    expect(parseEnv(baseEnv)).toMatchObject({
      OUTBOX_WORKER_ENABLED: false,
      DIRECT_META_WEBHOOK_ENABLED: false,
      DIRECT_META_SEND_ENABLED: false,
      GOOGLE_CALENDAR_ENABLED: false,
    });
  });

  it('requires legacy outbox target configuration when the legacy worker is enabled', () => {
    expect(() => parseEnv({ ...baseEnv, OUTBOX_WORKER_ENABLED: 'true' })).toThrow(/OUTBOX_TARGET_URL/);
    expect(() => parseEnv({
      ...baseEnv,
      OUTBOX_WORKER_ENABLED: 'true',
      OUTBOX_TARGET_URL: 'https://n8n.example.test/webhook',
      OUTBOX_TARGET_SECRET: 'short',
    })).toThrow(/OUTBOX_TARGET_SECRET/);
    expect(parseEnv({
      ...baseEnv,
      OUTBOX_WORKER_ENABLED: 'true',
      OUTBOX_TARGET_URL: 'https://n8n.example.test/webhook',
      OUTBOX_TARGET_SECRET: 'test_outbox_secret_123456',
    }).OUTBOX_WORKER_ENABLED).toBe(true);
  });

  it('rejects unknown worker kinds before a worker can start the wrong role', () => {
    expect(() => parseEnv({ ...baseEnv, WORKER_KIND: 'runtim' })).toThrow(/WORKER_KIND/);
    expect(parseEnv({ ...baseEnv, WORKER_KIND: 'runtime' }).WORKER_KIND).toBe('runtime');
  });

  it('requires Meta webhook verification secrets before direct webhooks can be enabled', () => {
    expect(() => parseEnv({ ...baseEnv, DIRECT_META_WEBHOOK_ENABLED: 'true' })).toThrow(/META_WEBHOOK_VERIFY_TOKEN/);
    expect(() => parseEnv({
      ...baseEnv,
      DIRECT_META_WEBHOOK_ENABLED: 'true',
      META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token',
      META_APP_SECRET: 'test_meta_app_secret',
    })).toThrow(/RUNTIME_WORKER_ENABLED/);
    expect(() => parseEnv({
      ...baseEnv,
      DIRECT_META_WEBHOOK_ENABLED: 'true',
      RUNTIME_WORKER_ENABLED: 'true',
      META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token',
      META_APP_SECRET: 'test_meta_app_secret',
    })).toThrow(/META_STATUS_PROCESSOR_ENABLED/);
    expect(parseEnv({
      ...baseEnv,
      DIRECT_META_WEBHOOK_ENABLED: 'true',
      RUNTIME_WORKER_ENABLED: 'true',
      META_STATUS_PROCESSOR_ENABLED: 'true',
      META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token',
      META_APP_SECRET: 'test_meta_app_secret',
    }).DIRECT_META_WEBHOOK_ENABLED).toBe(true);
  });

  it('requires the runtime worker before direct lead ingress can be enabled', () => {
    expect(() => parseEnv({ ...baseEnv, DIRECT_LEAD_INGRESS_ENABLED: 'true' })).toThrow(/RUNTIME_WORKER_ENABLED/);
    expect(parseEnv({
      ...baseEnv,
      DIRECT_LEAD_INGRESS_ENABLED: 'true',
      RUNTIME_WORKER_ENABLED: 'true',
    })).toMatchObject({
      DIRECT_LEAD_INGRESS_ENABLED: true,
      RUNTIME_WORKER_ENABLED: true,
    });
  });

  it('requires the runtime worker before n8n compatibility callback routes can be enabled', () => {
    expect(() => parseEnv({ ...baseEnv, N8N_COMPAT_ROUTES_ENABLED: 'true' })).toThrow(/RUNTIME_WORKER_ENABLED/);
    expect(parseEnv({
      ...baseEnv,
      N8N_COMPAT_ROUTES_ENABLED: 'true',
      RUNTIME_WORKER_ENABLED: 'true',
    })).toMatchObject({
      N8N_COMPAT_ROUTES_ENABLED: true,
      RUNTIME_WORKER_ENABLED: true,
    });
  });

  it('requires Meta send credentials before direct sends or active-turn compatibility can be enabled', () => {
    expect(() => parseEnv({ ...baseEnv, DIRECT_META_SEND_ENABLED: 'true' })).toThrow(/META_WA_ACCESS_TOKEN/);
    expect(() => parseEnv({ ...baseEnv, ACTIVE_TURN_COMPAT_ENABLED: 'true' })).toThrow(/DIRECT_META_SEND_ENABLED/);
    expect(parseEnv({
      ...baseEnv,
      DIRECT_META_SEND_ENABLED: 'true',
      ACTIVE_TURN_COMPAT_ENABLED: 'true',
      META_WA_ACCESS_TOKEN: 'test_meta_access_token',
      META_WA_PHONE_NUMBER_ID: 'test_phone_number_id',
    })).toMatchObject({
      DIRECT_META_SEND_ENABLED: true,
      ACTIVE_TURN_COMPAT_ENABLED: true,
    });
  });

  it('requires Google Calendar credentials before calendar dispatch can be enabled', () => {
    expect(() => parseEnv({ ...baseEnv, GOOGLE_CALENDAR_ENABLED: 'true' })).toThrow(/GOOGLE_CALENDAR_ACCESS_TOKEN/);
    expect(parseEnv({
      ...baseEnv,
      GOOGLE_CALENDAR_ENABLED: 'true',
      GOOGLE_CALENDAR_ACCESS_TOKEN: 'test_google_access_token',
    }).GOOGLE_CALENDAR_ENABLED).toBe(true);
  });
});
