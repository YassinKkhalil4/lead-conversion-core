import { z } from 'zod';
import type { ClaimedOutboxCommand } from '../infrastructure/runtime.js';
import type { OutboxDispatchResult } from './runtime-worker.js';
import type { MessageProvider, SendMessageCommand } from '../integrations/messaging/types.js';

const optionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const payloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('buttons'),
    text: z.string().min(1),
    options: z.array(optionSchema).min(1).max(3),
  }),
  z.object({
    kind: z.literal('list'),
    text: z.string().min(1),
    buttonText: z.string().min(1),
    options: z.array(optionSchema).min(1).max(10),
  }),
]);

const commandPayloadSchema = z.object({
  provider: z.literal('meta').default('meta'),
  phoneNumberId: z.string().default(''),
  toE164: z.string().min(5),
  message: payloadSchema,
});

export class MessagingOutboxDispatcher {
  constructor(private readonly providers: { meta: MessageProvider }) {}

  async dispatch(command: ClaimedOutboxCommand): Promise<OutboxDispatchResult> {
    if (command.commandType !== 'whatsapp.send_message') {
      return { outcome: 'permanently_failed', error: `unsupported_outbox_command:${command.commandType}` };
    }

    const parsed = commandPayloadSchema.safeParse(command.payload);
    if (!parsed.success) {
      return { outcome: 'permanently_failed', error: `invalid_whatsapp_send_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }

    const sendCommand: SendMessageCommand = {
      destination: {
        channel: 'whatsapp',
        provider: parsed.data.provider,
        phoneNumberId: parsed.data.phoneNumberId,
        toE164: parsed.data.toE164 || command.destination,
      },
      payload: parsed.data.message,
      idempotencyKey: command.idempotencyKey,
    };
    const result = await this.providers.meta.send(sendCommand);
    if (result.outcome === 'accepted') {
      return { outcome: 'delivered', providerMessageId: result.providerMessageId };
    }
    if (result.outcome === 'retryable') {
      return result.retryAfterSeconds === undefined
        ? { outcome: 'retryable', error: result.error }
        : { outcome: 'retryable', error: result.error, retryAfterSeconds: result.retryAfterSeconds };
    }
    if (result.outcome === 'delivery_unknown') {
      return { outcome: 'delivery_unknown', error: result.error };
    }
    return { outcome: 'permanently_failed', error: result.error };
  }
}
