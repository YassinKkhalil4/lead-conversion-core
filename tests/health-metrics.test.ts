import { afterEach, describe, expect, it, vi } from 'vitest';

describe('/metrics authentication', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('requires the internal secret', async () => {
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unused';
    process.env.EDGE_SHARED_SECRET = 'test_shared_secret_123456';
    process.env.EDGE_INTERNAL_SECRET = 'test_internal_secret_123456';

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const missing = await app.inject({ method: 'GET', url: '/metrics' });
      expect(missing.statusCode).toBe(401);

      const authorized = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { 'x-internal-secret': process.env.EDGE_INTERNAL_SECRET },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.headers['content-type']).toContain('text/plain');
    } finally {
      await app.close();
    }
  });
});

describe('/ready when the database is unreachable', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('reports unavailable without echoing the driver error', async () => {
    process.env.DATABASE_URL = 'postgresql://ops:hunter2@127.0.0.1:1/unused';
    process.env.EDGE_SHARED_SECRET = 'test_shared_secret_123456';
    process.env.EDGE_INTERNAL_SECRET = 'test_internal_secret_123456';

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const ready = await app.inject({ method: 'GET', url: '/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({ ok: false, database: 'unavailable' });
      expect(ready.body).not.toContain('127.0.0.1');
      expect(ready.body).not.toContain('ECONNREFUSED');
    } finally {
      await app.close();
    }
  });
});
