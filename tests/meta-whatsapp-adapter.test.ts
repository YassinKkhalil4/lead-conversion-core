import acceptedFixture from './fixtures/meta-whatsapp/send-accepted.json' with { type: 'json' };
import rateLimitFixture from './fixtures/meta-whatsapp/send-rate-limit.json' with { type: 'json' };
import validationFixture from './fixtures/meta-whatsapp/send-validation-error.json' with { type: 'json' };
import { describe, expect, it, vi } from 'vitest';
import { MetaWhatsAppAdapter, metaWhatsAppInternals } from '../src/integrations/messaging/meta-whatsapp-adapter.js';
import type { SendMessageCommand } from '../src/integrations/messaging/types.js';

const baseCommand: SendMessageCommand = {
  destination: {
    channel: 'whatsapp',
    provider: 'meta',
    phoneNumberId: 'phone-number-id-test',
    toE164: '+201000000001',
  },
  payload: {
    kind: 'text',
    text: 'Hello from a sanitized fixture',
  },
  idempotencyKey: 'message:lead-1:welcome',
};

function adapter(response: Response): { send: MetaWhatsAppAdapter; fetcher: ReturnType<typeof vi.fn> } {
  const fetcher = vi.fn(async () => response);
  return {
    send: new MetaWhatsAppAdapter(
      {
        enabled: true,
        accessToken: 'test-access-token',
        phoneNumberId: 'phone-number-id-test',
        graphApiVersion: 'v25.0',
      },
      fetcher,
    ),
    fetcher,
  };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('MetaWhatsAppAdapter', () => {
  it('does not send when disabled by configuration', async () => {
    const fetcher = vi.fn();
    const disabled = new MetaWhatsAppAdapter(
      {
        enabled: false,
        accessToken: '',
        phoneNumberId: '',
        graphApiVersion: 'v25.0',
      },
      fetcher,
    );

    await expect(disabled.send(baseCommand)).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'meta_whatsapp_disabled',
      providerResponse: {},
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies accepted provider responses and sends an idempotency key', async () => {
    const { send, fetcher } = adapter(jsonResponse(acceptedFixture, 200));
    const result = await send.send(baseCommand);

    expect(result).toEqual({
      outcome: 'accepted',
      providerMessageId: 'wamid.sanitized.accepted',
      providerResponse: acceptedFixture,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(baseCommand.idempotencyKey);
    expect(String(init.body)).toContain('201000000001');
  });

  it('classifies rate limits as retryable and preserves retry hints', async () => {
    const { send } = adapter(jsonResponse(rateLimitFixture, 429, { 'retry-after': '17' }));
    const result = await send.send(baseCommand);

    expect(result).toEqual({
      outcome: 'retryable',
      error: 'Application request limit reached',
      statusCode: 429,
      retryAfterSeconds: 17,
      providerResponse: rateLimitFixture,
    });
  });

  it('classifies validation errors as permanent failures', async () => {
    const { send } = adapter(jsonResponse(validationFixture, 400));
    const result = await send.send(baseCommand);

    expect(result).toEqual({
      outcome: 'permanently_failed',
      error: 'Invalid parameter',
      statusCode: 400,
      providerResponse: validationFixture,
    });
  });

  it('classifies thrown fetch failures as delivery unknown', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('socket closed after request write');
    });
    const send = new MetaWhatsAppAdapter(
      {
        enabled: true,
        accessToken: 'test-access-token',
        phoneNumberId: 'phone-number-id-test',
        graphApiVersion: 'v25.0',
      },
      fetcher,
    );

    const result = await send.send(baseCommand);
    expect(result.outcome).toBe('delivery_unknown');
    if (result.outcome !== 'delivery_unknown') throw new Error('expected_delivery_unknown');
    expect(result.error).toContain('socket closed');
  });

  it('builds bounded interactive payloads for Meta', () => {
    const payload = metaWhatsAppInternals.buildMetaPayload(
      {
        kind: 'buttons',
        text: 'Choose a project',
        options: [
          { id: 'option-1', title: 'North Residence' },
          { id: 'option-2', title: 'South Residence' },
          { id: 'option-3', title: 'East Residence' },
          { id: 'option-4', title: 'Overflow Residence' },
        ],
      },
      '+201000000001',
    );

    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '201000000001',
      type: 'interactive',
    });
    expect((payload.interactive as { action: { buttons: unknown[] } }).action.buttons).toHaveLength(3);
  });

  it('builds template payloads for Meta', () => {
    const payload = metaWhatsAppInternals.buildMetaPayload(
      {
        kind: 'template',
        templateName: 'lead_permission_v1',
        languageCode: 'en_US',
        components: [],
      },
      '+201000000001',
    );

    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '201000000001',
      type: 'template',
      template: {
        name: 'lead_permission_v1',
        language: { code: 'en_US' },
        components: [],
      },
    });
  });
});
