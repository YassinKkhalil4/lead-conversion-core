import { describe, expect, it } from 'vitest';
import { redactQueryParams, redactRequestHeaders, redactUrlSecrets, serializeRequestForLog } from '../src/config/log-redaction.js';

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
