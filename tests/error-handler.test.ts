import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { handleRequestError, httpStatusOf } from '../src/routes/error-handler.js';

function appThrowing(error: unknown) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(handleRequestError);
  app.get('/boom', async () => {
    throw error;
  });
  return app;
}

function withStatus(message: string, statusCode: unknown): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe('httpStatusOf', () => {
  it('keeps real client and server error statuses', () => {
    expect(httpStatusOf(withStatus('x', 400))).toBe(400);
    expect(httpStatusOf(withStatus('x', 401))).toBe(401);
    expect(httpStatusOf(withStatus('x', 503))).toBe(503);
    expect(httpStatusOf(withStatus('x', 599))).toBe(599);
  });

  it.each([0, 200, 302, 399, 600, 999, -1, 404.5, Number.NaN, '404', null, undefined])(
    'turns %s into a 500',
    (value) => {
      expect(httpStatusOf(withStatus('x', value))).toBe(500);
    },
  );

  it('treats a thrown non-error as a 500', () => {
    expect(httpStatusOf('plain string')).toBe(500);
    expect(httpStatusOf(null)).toBe(500);
    expect(httpStatusOf(undefined)).toBe(500);
  });
});

describe('request error handler', () => {
  it('echoes the message of a client error', async () => {
    const app = appThrowing(withStatus('Unauthorized', 401));
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' });
    await app.close();
  });

  it('never leaks the detail of a server error', async () => {
    const app = appThrowing(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ ok: false, error: 'internal_error' });
    expect(response.body).not.toContain('ECONNREFUSED');
    expect(response.body).not.toContain('hunter2');
    await app.close();
  });

  it('answers a bogus status code instead of crashing the handler', async () => {
    for (const bogus of [0, 999, Number.NaN, '404']) {
      const app = appThrowing(withStatus('secret internals', bogus));
      const response = await app.inject({ method: 'GET', url: '/boom' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ ok: false, error: 'internal_error' });
      await app.close();
    }
  });

  it('survives a thrown non-error value', async () => {
    const app = appThrowing('just a string');
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ ok: false, error: 'internal_error' });
    await app.close();
  });

  it('logs the error under `err` so the logger serialises its message and stack', async () => {
    const records: Array<Record<string, unknown>> = [];
    const app = Fastify({
      logger: {
        level: 'warn',
        stream: { write: (line: string) => records.push(JSON.parse(line)) },
      },
    });
    app.setErrorHandler(handleRequestError);
    app.get('/boom', async () => {
      throw new Error('driver exploded');
    });
    await app.inject({ method: 'GET', url: '/boom' });
    const entry = records.find((record) => record.msg === 'Request failed');
    expect(entry).toBeDefined();
    expect(entry?.level).toBe(50);
    expect(JSON.stringify(entry?.err)).toContain('driver exploded');
    await app.close();
  });

  it('logs client errors as warnings, not errors', async () => {
    const records: Array<Record<string, unknown>> = [];
    const app = Fastify({
      logger: { level: 'warn', stream: { write: (line: string) => records.push(JSON.parse(line)) } },
    });
    app.setErrorHandler(handleRequestError);
    app.get('/boom', async () => {
      throw withStatus('Unauthorized', 401);
    });
    await app.inject({ method: 'GET', url: '/boom' });
    expect(records.find((record) => record.msg === 'Request failed')?.level).toBe(40);
    await app.close();
  });
});
