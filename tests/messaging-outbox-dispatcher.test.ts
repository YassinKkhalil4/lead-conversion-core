import { describe, expect, it, vi } from 'vitest';
import { MessagingOutboxDispatcher } from '../src/worker/messaging-outbox-dispatcher.js';
import type { ClaimedOutboxCommand } from '../src/infrastructure/runtime.js';
import type { MessageProvider } from '../src/integrations/messaging/types.js';

function command(overrides: Partial<ClaimedOutboxCommand> = {}): ClaimedOutboxCommand {
  return {
    outboxCommandId: '6f5f5aa4-21e3-4877-b844-ccdc3563e21b',
    commandType: 'whatsapp.send_message',
    destination: '+201000000001',
    idempotencyKey: 'message:lead-1:welcome',
    attemptCount: 1,
    payload: {
      provider: 'meta',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000001',
      message: {
        kind: 'text',
        text: 'Welcome',
      },
    },
    ...overrides,
  };
}

describe('MessagingOutboxDispatcher', () => {
  it('maps accepted provider sends to delivered outbox outcomes', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.sanitized.accepted',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'wamid.sanitized.accepted',
    });
    expect(provider.send).toHaveBeenCalledWith({
      destination: {
        channel: 'whatsapp',
        provider: 'meta',
        phoneNumberId: 'phone-number-id-test',
        toE164: '+201000000001',
      },
      payload: { kind: 'text', text: 'Welcome' },
      idempotencyKey: 'message:lead-1:welcome',
    });
  });

  it('preserves retry hints from retryable provider outcomes', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'retryable' as const,
        error: 'Application request limit reached',
        retryAfterSeconds: 17,
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'retryable',
      error: 'Application request limit reached',
      retryAfterSeconds: 17,
    });
  });

  it('rejects unsupported command types without calling the provider', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.should-not-send',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({ commandType: 'calendar.create_event' }))).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'unsupported_outbox_command:calendar.create_event',
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('rejects malformed send payloads without calling the provider', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.should-not-send',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    const result = await dispatcher.dispatch(command({ payload: { message: { kind: 'text', text: '' } } }));
    expect(result.outcome).toBe('permanently_failed');
    if (result.outcome !== 'permanently_failed') throw new Error('expected_permanent_failure');
    expect(result.error).toContain('invalid_whatsapp_send_payload');
    expect(provider.send).not.toHaveBeenCalled();
  });
});
