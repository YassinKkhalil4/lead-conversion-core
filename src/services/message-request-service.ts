import { z } from 'zod';
import { approvedTemplateNames } from '../config/approved-templates.js';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';
import type { MessagingPayload } from '../integrations/messaging/types.js';

const optionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const messagePayloadSchema = z.discriminatedUnion('kind', [
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
  z.object({
    kind: z.literal('template'),
    templateName: z.string().min(1),
    languageCode: z.string().min(2),
    components: z.array(z.record(z.unknown())).default([]),
  }),
]);

const requestSchema = z.object({
  clientId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  requestKey: z.string().min(1),
  phoneNumberId: z.string().default(''),
  toE164: z.string().min(5),
  payload: messagePayloadSchema,
  conversationWindowExpiresAt: z.string().datetime().optional(),
  actorId: z.string().default('system'),
});

export type MessageRequestInput = z.input<typeof requestSchema>;

export interface MessageRequestResult {
  messageId: string;
  outboxCommandId: string;
  idempotencyKey: string;
}

export function messageText(payload: MessagingPayload): string {
  return payload.kind === 'template' ? payload.templateName : payload.text;
}

export function messageIdempotencyKey(input: Pick<MessageRequestInput, 'clientId' | 'requestKey' | 'payload'>): string {
  return `whatsapp.send:${input.clientId}:${input.requestKey}:${sha256Hex(stableJson(input.payload)).slice(0, 24)}`;
}

export class MessageRequestService {
  constructor(
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
    private readonly policy = {
      approvedTemplateNames: approvedTemplateNames(
        getEnv().META_APPROVED_TEMPLATE_NAMES,
        getEnv().META_DEFAULT_TEMPLATE_LANGUAGE,
      ),
      now: () => new Date(),
    },
  ) {}

  async requestWhatsAppSend(input: MessageRequestInput): Promise<MessageRequestResult> {
    const parsed = requestSchema.parse(input);
    this.validatePolicy(parsed);
    const idempotencyKey = messageIdempotencyKey(parsed);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const message = await client.query<{ message_id: string; inserted: boolean }>(
        `INSERT INTO app.messages
          (conversation_id, lead_id, client_id, contact_id, direction, channel,
           to_address, message_text, message_type, state, raw_payload, idempotency_key)
         VALUES ($1, $2, $3, $4, 'outbound', 'whatsapp',
           $5, $6, $7, 'queued', $8::jsonb, $9)
         ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key <> ''
         DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING message_id, (xmax = 0) AS inserted`,
        [
          parsed.conversationId || null,
          parsed.leadId || null,
          parsed.clientId,
          parsed.contactId || null,
          parsed.toE164,
          messageText(parsed.payload),
          parsed.payload.kind,
          JSON.stringify({
            provider: 'meta',
            phoneNumberId: parsed.phoneNumberId,
            toE164: parsed.toE164,
            message: parsed.payload,
            idempotencyKey,
          }),
          idempotencyKey,
        ],
      );
      const messageId = message.rows[0]?.message_id;
      if (!messageId) throw new Error('message_not_created');
      const outboxCommandId = await this.outbox.enqueue(client, {
        commandType: 'whatsapp.send_message',
        destination: parsed.toE164,
        idempotencyKey,
        aggregateKey: parsed.leadId || parsed.contactId || parsed.clientId,
        payload: {
          provider: 'meta',
          phoneNumberId: parsed.phoneNumberId,
          toE164: parsed.toE164,
          message: parsed.payload,
          messageId,
        },
      });
      if (message.rows[0]?.inserted) {
        await this.audit.record(client, {
          eventType: 'message.send_requested',
          actorType: 'system',
          actorId: parsed.actorId,
          aggregateType: 'message',
          aggregateId: messageId,
          correlationId: idempotencyKey,
          payload: {
            channel: 'whatsapp',
            provider: 'meta',
            state: 'queued',
          },
          after: {
            messageId,
            state: 'queued',
          },
        });
      }
      await client.query('COMMIT');
      return { messageId, outboxCommandId, idempotencyKey };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private validatePolicy(parsed: z.output<typeof requestSchema>): void {
    if (parsed.payload.kind === 'template') {
      if (!this.policy.approvedTemplateNames.includes(parsed.payload.templateName)) {
        throw new Error(`whatsapp_template_not_approved:${parsed.payload.templateName}`);
      }
      return;
    }
    if (!parsed.conversationWindowExpiresAt) {
      throw new Error('conversation_window_required_for_session_message');
    }
    const expiresAt = Date.parse(parsed.conversationWindowExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.policy.now().getTime()) {
      throw new Error('conversation_window_expired');
    }
  }
}
