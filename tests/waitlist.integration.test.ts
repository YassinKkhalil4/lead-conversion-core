import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

function commandExists(command: string): boolean {
  try {
    execFileSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasPostgres = ['initdb', 'pg_ctl', 'createdb', 'psql'].every(commandExists);
const describePg = hasPostgres ? describe : describe.skip;

describePg('waitlist signup endpoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'lead-core-waitlist-test.'));
  const dataDir = join(root, 'data');
  // Above every other integration test's band (the highest is dashboard-api at
  // 60_500-61_499) so concurrent runs cannot land two clusters on one port.
  const port = 61_700 + Math.floor(Math.random() * 500);
  const dbName = 'lead_core_waitlist_test';
  const databaseUrl = `postgresql://127.0.0.1:${port}/${dbName}`;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    EDGE_SHARED_SECRET: 'test_shared_secret_123456',
    EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
    META_APP_SECRET: 'test_meta_app_secret_123456',
    META_WEBHOOK_VERIFY_TOKEN: 'test_meta_verify_token_123456',
    WAITLIST_SIGNUP_ENABLED: 'true',
    WAITLIST_SIGNUP_IP_LIMIT: '3',
    WAITLIST_SIGNUP_IP_WINDOW_MS: '3600000',
    WAITLIST_SIGNUP_EMAIL_LIMIT: '2',
    WAITLIST_SIGNUP_EMAIL_WINDOW_MS: '86400000',
    WAITLIST_SIGNUP_MESSAGE_MAX_LENGTH: '2000',
  };

  let db: typeof import('../src/db/pool.js');
  let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;

  beforeAll(async () => {
    execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -k ${root}`, '-l', join(root, 'postgres.log'), 'start'], { stdio: 'ignore' });
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), dbName], { stdio: 'ignore' });
    execFileSync('npm', ['run', 'migrate'], { env, stdio: 'ignore' });
    for (const [key, value] of Object.entries(env)) process.env[key] = value as string;

    db = await import('../src/db/pool.js');
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  }, 60_000);

  beforeEach(async () => {
    await db.pool.query(`
      TRUNCATE
        app.waitlist_signups, app.waitlist_attempts,
        runtime.outbox_commands,
        audit.events
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
      if (db) await db.closePool();
    } finally {
      try {
        execFileSync('pg_ctl', ['-D', dataDir, 'stop'], { stdio: 'ignore' });
      } catch {
        // Cleanup continues even if the cluster is already gone.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  const ROUTE = '/public/waitlist';

  function post(payload: Record<string, unknown>, ip = '203.0.113.10') {
    return app.inject({
      method: 'POST',
      url: ROUTE,
      payload,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'waitlist-test',
        // One loopback hop, as Caddy will present it.
        'x-forwarded-for': ip,
      },
      remoteAddress: '127.0.0.1',
    });
  }

  async function signupRows() {
    const result = await db.pool.query(
      'SELECT * FROM app.waitlist_signups ORDER BY created_at',
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  it('stores a valid submission, audits it, and enqueues the notification command', async () => {
    const response = await post({
      email: 'Buyer@Example.COM',
      companyName: 'Harbour View Realty',
      market: 'dubai_uae',
      message: 'We run about 200 leads a month.',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const rows = await signupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('Buyer@Example.COM');
    expect(rows[0]?.email_normalized).toBe('buyer@example.com');
    expect(rows[0]?.company_name).toBe('Harbour View Realty');
    expect(rows[0]?.market).toBe('dubai_uae');
    expect(rows[0]?.source).toBe('kadensio_landing');
    expect(rows[0]?.submission_count).toBe(1);

    // Only the whitelisted headers are persisted.
    expect(Object.keys(rows[0]?.request_headers as object).sort())
      .toEqual(['accept-language', 'content-type', 'user-agent']);

    const audit = await db.pool.query(
      "SELECT event_type, aggregate_type, aggregate_id, payload_json FROM audit.events WHERE event_type='waitlist.signup_received'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.aggregate_id).toBe(rows[0]?.waitlist_signup_id);
    expect(audit.rows[0]?.payload_json).toMatchObject({ repeat: false, submissionCount: 1 });

    const outbox = await db.pool.query(
      "SELECT command_type, payload_json FROM runtime.outbox_commands WHERE command_type='waitlist.signup_notification'",
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]?.payload_json).toMatchObject({
      waitlistSignupId: rows[0]?.waitlist_signup_id,
      repeat: false,
    });
  });

  it('never echoes stored data back in the response', async () => {
    const response = await post({ email: 'quiet@example.com', companyName: 'Secret Co' });
    expect(response.json()).toEqual({ ok: true });
    expect(response.body).not.toContain('Secret Co');
    expect(response.body).not.toContain('quiet@example.com');
  });

  it('updates on a repeat email instead of duplicating, and does not error', async () => {
    const first = await post({
      email: 'repeat@example.com',
      companyName: 'First Name',
      market: 'egypt',
      message: 'first message',
    });
    expect(first.statusCode).toBe(200);

    const second = await post({
      email: 'REPEAT@example.com',
      companyName: 'Corrected Name',
      market: 'dubai_uae',
      message: 'second message',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true });

    const rows = await signupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.company_name).toBe('Corrected Name');
    expect(rows[0]?.market).toBe('dubai_uae');
    expect(rows[0]?.message).toBe('second message');
    expect(rows[0]?.submission_count).toBe(2);
    expect(rows[0]?.updated_at).not.toEqual(rows[0]?.created_at);

    // A repeat is a distinct notification, not an idempotency collision.
    const outbox = await db.pool.query(
      "SELECT idempotency_key FROM runtime.outbox_commands WHERE command_type='waitlist.signup_notification' ORDER BY created_at",
    );
    expect(outbox.rows).toHaveLength(2);
    expect(new Set(outbox.rows.map((r) => r.idempotency_key)).size).toBe(2);
  });

  it('keeps an earlier optional value when a repeat submission omits it', async () => {
    await post({ email: 'partial@example.com', companyName: 'Original Co', market: 'egypt' });
    await post({ email: 'partial@example.com' });

    const rows = await signupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.company_name).toBe('Original Co');
    expect(rows[0]?.market).toBe('egypt');
  });

  it('rejects an invalid email with 400 and issues, storing nothing', async () => {
    const response = await post({ email: 'not-an-email' });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_waitlist_submission');
    expect(body.issues[0]).toMatchObject({ path: 'email' });

    expect(await signupRows()).toHaveLength(0);
  });

  it('rejects an oversized message with 400, storing nothing', async () => {
    const response = await post({
      email: 'verbose@example.com',
      message: 'x'.repeat(2001),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0]).toMatchObject({ path: 'message' });
    expect(await signupRows()).toHaveLength(0);
  });

  it('rejects an unknown market with 400', async () => {
    const response = await post({ email: 'market@example.com', market: 'antarctica' });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0]).toMatchObject({ path: 'market' });
    expect(await signupRows()).toHaveLength(0);
  });

  it('silently discards a honeypot submission and stores nothing', async () => {
    const response = await post({
      email: 'bot@example.com',
      website: 'http://spam.example',
    });

    // Indistinguishable from an accepted signup.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    expect(await signupRows()).toHaveLength(0);
    const audit = await db.pool.query('SELECT 1 FROM audit.events');
    expect(audit.rows).toHaveLength(0);
    const outbox = await db.pool.query('SELECT 1 FROM runtime.outbox_commands');
    expect(outbox.rows).toHaveLength(0);
  });

  it('rate limits by IP and stores nothing once the cap is passed', async () => {
    // IP cap is 3; each uses a distinct email so the email cap cannot fire.
    for (let i = 0; i < 3; i += 1) {
      const ok = await post({ email: `ip-capped-${i}@example.com` }, '198.51.100.77');
      expect(ok.statusCode).toBe(200);
    }
    expect(await signupRows()).toHaveLength(3);

    const blocked = await post({ email: 'ip-capped-overflow@example.com' }, '198.51.100.77');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ ok: false, error: 'waitlist_rate_limited' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // The rejected submission left no row, no audit event and no outbox command.
    expect(await signupRows()).toHaveLength(3);
    const audit = await db.pool.query('SELECT 1 FROM audit.events');
    expect(audit.rows).toHaveLength(3);
    const outbox = await db.pool.query('SELECT 1 FROM runtime.outbox_commands');
    expect(outbox.rows).toHaveLength(3);
  });

  it('rate limits by email across different IPs', async () => {
    // Email cap is 2, and each request comes from a fresh IP so only the email
    // counter can be what rejects the third.
    expect((await post({ email: 'same@example.com' }, '198.51.100.1')).statusCode).toBe(200);
    expect((await post({ email: 'same@example.com' }, '198.51.100.2')).statusCode).toBe(200);

    const blocked = await post({ email: 'same@example.com' }, '198.51.100.3');
    expect(blocked.statusCode).toBe(429);

    const rows = await signupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.submission_count).toBe(2);
  });

  it('a rejected request cannot roll back its own counter', async () => {
    for (let i = 0; i < 3; i += 1) {
      await post({ email: `counter-${i}@example.com` }, '198.51.100.90');
    }
    await post({ email: 'counter-blocked@example.com' }, '198.51.100.90');

    // The 4th attempt was rejected, but it still counted.
    const attempts = await db.pool.query<{ attempt_count: number }>(
      "SELECT attempt_count FROM app.waitlist_attempts WHERE attempt_key LIKE 'waitlist:ip:%'",
    );
    expect(attempts.rows[0]?.attempt_count).toBe(4);
  });

  it('does not store the raw email in the rate limit table', async () => {
    await post({ email: 'private@example.com' });
    const keys = await db.pool.query<{ attempt_key: string }>(
      'SELECT attempt_key FROM app.waitlist_attempts',
    );
    for (const row of keys.rows) {
      expect(row.attempt_key).not.toContain('private@example.com');
    }
  });
});
