import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

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

      const activeCompat = await app.inject({
        method: 'POST',
        url: '/v1/turn',
        headers: { 'x-edge-secret': 'test_shared_secret_123456' },
        payload: {},
      });
      expect(activeCompat.statusCode).toBe(503);
      expect(activeCompat.json()).toEqual({
        ok: false,
        handled: false,
        error: 'active_turn_compat_disabled',
      });
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

  it('verifies disabled direct ingress routes through the deployment verification script', async () => {
    const app = await buildAppWithEnv({
      DIRECT_META_WEBHOOK_ENABLED: 'false',
      DIRECT_LEAD_INGRESS_ENABLED: 'false',
      N8N_COMPAT_ROUTES_ENABLED: 'true',
    });
    const root = mkdtempSync(join(tmpdir(), 'lead-core-verify-deployment.'));
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_unavailable');
      const envFile = join(root, 'verify.env');
      writeFileSync(envFile, [
        'EDGE_SHARED_SECRET=test_shared_secret_123456',
        'EDGE_INTERNAL_SECRET=test_internal_secret_123456',
        'META_WEBHOOK_VERIFY_TOKEN=test_meta_verify_token_123456',
        'DIRECT_META_WEBHOOK_ENABLED=false',
        'DIRECT_LEAD_INGRESS_ENABLED=false',
        'N8N_COMPAT_ROUTES_ENABLED=true',
      ].join('\n'));
      const { stdout } = await execFileAsync('bash', [
        'scripts/verify-deployment.sh',
        `--env-file=${envFile}`,
        `--base-url=http://127.0.0.1:${address.port}`,
        '--skip-ready',
        '--skip-shadow',
        '--check-direct-meta',
        '--check-direct-lead',
        '--expect-direct-meta=disabled',
        '--expect-direct-lead=disabled',
      ], {
        cwd: process.cwd(),
        timeout: 10_000,
      });
      expect(stdout).toContain('Direct Meta challenge (disabled):');
      expect(stdout).toContain('Direct website lead ingress (disabled):');
      expect(stdout).toContain('Direct Facebook lead ingress (disabled):');
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('verifies enabled direct lead ingress with a validation probe instead of creating a lead', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-verify-direct-lead.'));
    const seenBodies = new Map<string, string>();
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }
      if (request.method === 'POST' && request.url === '/webhooks/leads/website') {
        let body = '';
        request.on('data', (chunk) => {
          body += String(chunk);
        });
        request.on('end', () => {
          seenBodies.set('website', body);
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end('{"ok":false,"error":"invalid_lead_payload"}');
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/webhooks/leads/facebook') {
        let body = '';
        request.on('data', (chunk) => {
          body += String(chunk);
        });
        request.on('end', () => {
          seenBodies.set('facebook', body);
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end('{"ok":false,"error":"invalid_lead_payload"}');
        });
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"ok":false}');
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_unavailable');
      const envFile = join(root, 'verify.env');
      writeFileSync(envFile, [
        'EDGE_SHARED_SECRET=test_shared_secret_123456',
        'DIRECT_LEAD_INGRESS_ENABLED=true',
      ].join('\n'));

      const { stdout } = await execFileAsync('bash', [
        'scripts/verify-deployment.sh',
        `--env-file=${envFile}`,
        `--base-url=http://127.0.0.1:${address.port}`,
        '--skip-ready',
        '--skip-shadow',
        '--check-direct-lead',
        '--expect-direct-lead=enabled',
      ], {
        cwd: process.cwd(),
        timeout: 10_000,
      });

      expect(stdout).toContain('Direct website lead ingress (enabled):');
      expect(stdout).toContain('Direct Facebook lead ingress (enabled):');
      const websiteBody = seenBodies.get('website');
      const facebookBody = seenBodies.get('facebook');
      if (!websiteBody) throw new Error('direct_website_lead_probe_body_missing');
      if (!facebookBody) throw new Error('direct_facebook_lead_probe_body_missing');
      const websitePayload = JSON.parse(websiteBody) as Record<string, unknown>;
      expect(websitePayload.eventId).toMatch(/^verify-direct-website-lead-invalid-/);
      expect(websitePayload.clientKey).toBe('verify-deployment');
      expect(websitePayload).not.toHaveProperty('phone');
      expect(websitePayload).not.toHaveProperty('name');
      const facebookPayload = JSON.parse(facebookBody) as Record<string, unknown>;
      expect(facebookPayload.leadgen_id).toMatch(/^verify-direct-facebook-lead-invalid-/);
      expect(facebookPayload.clientKey).toBe('verify-deployment');
      expect(facebookPayload).not.toHaveProperty('field_data');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
