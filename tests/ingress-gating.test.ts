import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  RUNTIME_WORKER_ENABLED: 'false',
  META_STATUS_PROCESSOR_ENABLED: 'false',
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

  it('requires explicit direct-ingress enablement for public webhook families', async () => {
    const app = await buildAppWithEnv({
      DIRECT_META_WEBHOOK_ENABLED: 'false',
      DIRECT_LEAD_INGRESS_ENABLED: 'false',
      RUNTIME_WORKER_ENABLED: 'true',
    });
    try {
      const meta = await app.inject({
        method: 'GET',
        url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=test_meta_verify_token_123456&hub.challenge=challenge-ok',
      });
      expect(meta.statusCode).toBe(503);
      expect(meta.json()).toEqual({ ok: false, error: 'direct_meta_webhook_disabled' });

      const metaPost = await app.inject({
        method: 'POST',
        url: '/webhooks/meta/whatsapp',
        payload: { object: 'whatsapp_business_account' },
      });
      expect(metaPost.statusCode).toBe(503);
      expect(metaPost.json()).toEqual({ ok: false, error: 'direct_meta_webhook_disabled' });

      const lead = await app.inject({
        method: 'POST',
        url: '/webhooks/leads/website',
        payload: { eventId: 'evt-disabled', phone: '+201000000001' },
      });
      expect(lead.statusCode).toBe(503);
      expect(lead.json()).toEqual({ ok: false, error: 'direct_lead_ingress_disabled' });
    } finally {
      await app.close();
    }
  });

  it('allows the direct Meta challenge only when explicitly enabled', async () => {
    const app = await buildAppWithEnv({
      DIRECT_META_WEBHOOK_ENABLED: 'true',
      DIRECT_LEAD_INGRESS_ENABLED: 'false',
      RUNTIME_WORKER_ENABLED: 'true',
      META_STATUS_PROCESSOR_ENABLED: 'true',
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
      RUNTIME_WORKER_ENABLED: 'true',
    });
    const root = mkdtempSync(join(tmpdir(), 'lead-core-verify-deployment.'));
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('test_server_address_unavailable');
      const envFile = join(root, 'verify.env');
      writeFileSync(envFile, [
        'DIRECT_META_WEBHOOK_ENABLED=false',
        'DIRECT_LEAD_INGRESS_ENABLED=false',
      ].join('\n'));
      const { stdout } = await execFileAsync('bash', [
        'scripts/verify-deployment.sh',
        `--env-file=${envFile}`,
        `--base-url=http://127.0.0.1:${address.port}`,
        '--skip-ready',
        '--check-direct-meta',
        '--check-direct-lead',
        '--expect-direct-meta=disabled',
        '--expect-direct-lead=disabled',
      ], {
        cwd: process.cwd(),
        env: {
          HOME: process.env.HOME || '',
          PATH: process.env.PATH || '',
          TMPDIR: process.env.TMPDIR || tmpdir(),
        },
        timeout: 10_000,
      });
      expect(stdout).toContain('Direct Meta challenge (disabled):');
      expect(stdout).toContain('Direct Meta disabled webhook POST:');
      expect(stdout).toContain('Direct website lead ingress (disabled):');
      expect(stdout).toContain('Direct Facebook lead ingress (disabled):');
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('verifies enabled direct lead ingress with durable-receipt probes instead of creating leads', async () => {
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
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"ok":true,"received":1,"duplicate":false}');
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
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"ok":true,"received":1,"duplicate":false}');
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
        '--check-direct-lead',
        '--expect-direct-lead=enabled',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VERIFY_DEPLOYMENT_RUN_ID: 'direct-lead-test-run',
        },
        timeout: 10_000,
      });

      expect(stdout).toContain('Direct website lead ingress (enabled):');
      expect(stdout).toContain('Direct Facebook lead ingress (enabled):');
      const websiteBody = seenBodies.get('website');
      const facebookBody = seenBodies.get('facebook');
      if (!websiteBody) throw new Error('direct_website_lead_probe_body_missing');
      if (!facebookBody) throw new Error('direct_facebook_lead_probe_body_missing');
      const websitePayload = JSON.parse(websiteBody) as Record<string, unknown>;
      expect(websitePayload.eventId).toBe('verify-direct-website-lead-invalid-direct-lead-test-run');
      expect(websitePayload.clientKey).toBe('verify-deployment');
      expect(websitePayload).not.toHaveProperty('phone');
      expect(websitePayload).not.toHaveProperty('name');
      const facebookPayload = JSON.parse(facebookBody) as Record<string, unknown>;
      expect(facebookPayload.leadgen_id).toBe('verify-direct-facebook-lead-invalid-direct-lead-test-run');
      expect(facebookPayload.clientKey).toBe('verify-deployment');
      expect(facebookPayload).not.toHaveProperty('field_data');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('verifies enabled direct Meta ingress with a signed non-customer webhook probe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-verify-direct-meta.'));
    let challengeVerified = false;
    let signedProbeVerified = false;
    let unsignedProbeRejected = false;
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }
      if (request.method === 'GET' && request.url?.startsWith('/webhooks/meta/whatsapp')) {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.searchParams.get('hub.verify_token') !== 'test_meta_verify_token_123456') {
          response.writeHead(403, { 'content-type': 'application/json' });
          response.end('{"ok":false}');
          return;
        }
        challengeVerified = true;
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(url.searchParams.get('hub.challenge') || '');
        return;
      }
      if (request.method === 'POST' && request.url === '/webhooks/meta/whatsapp') {
        let body = '';
        request.on('data', (chunk) => {
          body += String(chunk);
        });
        request.on('end', () => {
          const expected = `sha256=${createHmac('sha256', 'test_meta_app_secret_123456').update(body).digest('hex')}`;
          if (request.headers['x-hub-signature-256'] !== expected) {
            unsignedProbeRejected = request.headers['x-hub-signature-256'] === undefined && body.includes('verify-deployment-phone-number');
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end('{"ok":false,"error":"invalid_signature"}');
            return;
          }
          const payload = JSON.parse(body) as Record<string, unknown>;
          signedProbeVerified = payload.object === 'whatsapp_business_account' && body.includes('verify-deployment-phone-number');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"ok":true,"received":1,"duplicates":0}');
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
        'META_WEBHOOK_VERIFY_TOKEN=test_meta_verify_token_123456',
        'META_APP_SECRET=test_meta_app_secret_123456',
        'DIRECT_META_WEBHOOK_ENABLED=true',
      ].join('\n'));

      const { stdout } = await execFileAsync('bash', [
        'scripts/verify-deployment.sh',
        `--env-file=${envFile}`,
        `--base-url=http://127.0.0.1:${address.port}`,
        '--skip-ready',
        '--check-direct-meta',
        '--expect-direct-meta=enabled',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VERIFY_DEPLOYMENT_RUN_ID: 'direct-meta-test-run',
        },
        timeout: 10_000,
      });

      expect(stdout).toContain('Direct Meta challenge (enabled):');
      expect(stdout).toContain('Direct Meta signed webhook (enabled):');
      expect(stdout).toContain('Direct Meta unsigned webhook rejection:');
      expect(challengeVerified).toBe(true);
      expect(signedProbeVerified).toBe(true);
      expect(unsignedProbeRejected).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps shared secrets out of verifier curl process arguments', () => {
    const script = readFileSync('scripts/verify-deployment.sh', 'utf8');
    expect(script).not.toContain('-H "X-Edge-Secret: $EDGE_SHARED_SECRET"');
    expect(script).not.toContain("-H 'X-Edge-Secret: $EDGE_SHARED_SECRET'");
    expect(script).toContain('-H "@$tmp_edge_header"');
    expect(script).not.toContain('set -a');
    expect(script).not.toContain('set +a');
    expect(script).not.toContain('source "$ENV_FILE"');
    expect(script).toContain('python3 scripts/ops/read-env-file.py "$file"');
    expect(script).toContain('chmod 600 "$tmp_assignments"');
    expect(script).not.toContain('status_request "$BASE/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN');
    expect(script).toContain('status_request --config "$tmp_meta_curl_config"');
    expect(script).toContain('status_request --config "$tmp_meta_post_config"');
    expect(script).toContain('status_request --config "$tmp_meta_unsigned_post_config"');
    expect(script).not.toContain('python3 - "$META_APP_SECRET"');
    expect(script).toContain('VERIFY_DEPLOYMENT_RUN_ID="${VERIFY_DEPLOYMENT_RUN_ID:-$(date +%s)-$$-${RANDOM:-0}}"');
    expect(script).not.toContain('event="verify-direct-website-lead-invalid-$(date +%s)"');
    expect(script).not.toContain('event="verify-direct-facebook-lead-invalid-$(date +%s)"');
  });
});
