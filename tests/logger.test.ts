import { describe, expect, it } from 'vitest';
import { redactQueryParams, redactRequestHeaders, redactUrlSecrets, serializeErrorForLog, serializeRequestForLog } from '../src/config/log-redaction.js';

describe('logger error serialization', () => {
  it('records message, stack and status code so a 500 is diagnosable', () => {
    const error = Object.assign(new Error('reply_failed'), { statusCode: 500 });
    const serialized = serializeErrorForLog(error);

    expect(serialized.type).toBe('Error');
    expect(serialized.message).toBe('reply_failed');
    expect(String(serialized.stack)).toContain('reply_failed');
    expect(serialized.statusCode).toBe(500);
  });

  it('keeps PostgreSQL failure identifiers but never the row values they reference', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "contacts_client_id_phone_e164_key"'), {
      code: '23505',
      severity: 'ERROR',
      constraint: 'contacts_client_id_phone_e164_key',
      table: 'contacts',
      schema: 'app',
      routine: '_bt_check_unique',
      detail: 'Key (client_id, phone_e164)=(0e37, +201001234567) already exists.',
      hint: 'some hint',
      where: 'PL/pgSQL function inline_code_block line 3',
      internalQuery: 'SELECT 1',
    });

    const serialized = serializeErrorForLog(pgError);

    expect(serialized).toMatchObject({
      code: '23505',
      constraint: 'contacts_client_id_phone_e164_key',
      table: 'contacts',
      schema: 'app',
    });
    expect(serialized.detail).toBeUndefined();
    expect(serialized.hint).toBeUndefined();
    expect(serialized.where).toBeUndefined();
    expect(serialized.internalQuery).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('+201001234567');
  });

  it('follows the cause chain and tolerates non-Error throwables', () => {
    const wrapped = new Error('outer', { cause: new Error('inner_root_cause') });
    const serialized = serializeErrorForLog(wrapped);
    expect((serialized.cause as Record<string, unknown>).message).toBe('inner_root_cause');

    expect(serializeErrorForLog('plain string failure')).toMatchObject({
      type: 'NonError',
      message: 'plain string failure',
    });
  });
});

describe('logger secret redaction', () => {
  it('redacts Meta verify tokens and other query-string credentials while preserving route evidence', () => {
    expect(redactUrlSecrets('/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=secret-value&hub.challenge=ok'))
      .toBe('/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=**redacted**&hub.challenge=ok');
    expect(redactUrlSecrets('/callback?access_token=abc&client_secret=def&state=keep'))
      .toBe('/callback?access_token=**redacted**&client_secret=**redacted**&state=keep');
  });

  it('redacts request headers used for internal and provider authentication', () => {
    expect(redactRequestHeaders({
      authorization: 'Bearer secret',
      'x-edge-secret': 'edge-secret',
      'x-internal-secret': 'internal-secret',
      'x-hub-signature-256': 'sha256=signature',
      'content-type': 'application/json',
    })).toEqual({
      authorization: '**redacted**',
      'x-edge-secret': '**redacted**',
      'x-internal-secret': '**redacted**',
      'x-hub-signature-256': '**redacted**',
      'content-type': 'application/json',
    });
  });

  it('redacts serialized query objects used by Fastify request logs', () => {
    expect(redactQueryParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'secret-token',
      'hub.challenge': 'keep',
      access_token: 'access-token',
    })).toEqual({
      'hub.mode': 'subscribe',
      'hub.verify_token': '**redacted**',
      'hub.challenge': 'keep',
      access_token: '**redacted**',
    });
  });

  it('serializes request logs without leaking query tokens or authentication headers', () => {
    const serialized = serializeRequestForLog({
      id: 'req-test',
      method: 'GET',
      url: '/webhooks/meta/whatsapp?hub.verify_token=secret-token&hub.challenge=ok',
      query: {
        'hub.verify_token': 'secret-token',
        'hub.challenge': 'ok',
      },
      headers: {
        'x-edge-secret': 'edge-secret',
        'x-hub-signature-256': 'sha256=signature',
        'user-agent': 'test',
      },
      socket: {
        remoteAddress: '127.0.0.1',
        remotePort: 12345,
      },
    });

    expect(serialized.url).toBe('/webhooks/meta/whatsapp?hub.verify_token=**redacted**&hub.challenge=ok');
    expect(serialized.query).toMatchObject({
      'hub.verify_token': '**redacted**',
      'hub.challenge': 'ok',
    });
    expect(serialized.headers).toMatchObject({
      'x-edge-secret': '**redacted**',
      'x-hub-signature-256': '**redacted**',
      'user-agent': 'test',
    });
  });
});
