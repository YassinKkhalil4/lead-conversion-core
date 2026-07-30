import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  AuditRepository,
  InboxRepository,
  sha256Hex,
  stableJson,
  type ClaimedInboxEvent,
} from '../infrastructure/runtime.js';
import type { InboxProcessingResult } from '../worker/runtime-worker.js';

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
}).passthrough();

const storedStatusSchema = z.object({
  webhookType: z.literal('whatsapp.message_status'),
  eventKey: z.string().min(1),
  providerMessageId: z.string().min(1),
  providerStatus: z.string().min(1),
  providerTimestamp: z.string().datetime().nullable(),
  recipientId: z.string(),
  rawStatus: z.record(z.unknown()),
});

const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string().min(1),
  text: z.object({ body: z.string().optional().default('') }).optional(),
  button: z.object({
    payload: z.string().optional().default(''),
    text: z.string().optional().default(''),
  }).optional(),
  interactive: z.object({
    button_reply: z.object({
      id: z.string().optional().default(''),
      title: z.string().optional().default(''),
    }).optional(),
    list_reply: z.object({
      id: z.string().optional().default(''),
      title: z.string().optional().default(''),
    }).optional(),
  }).optional(),
}).passthrough();

export interface ParsedMetaStatus {
  eventKey: string;
  providerMessageId: string;
  providerStatus: string;
  providerTimestamp: string | null;
  recipientId: string;
  rawStatus: Record<string, unknown>;
}

export interface MetaWebhookReceiptResult {
  received: number;
  duplicates: number;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function metaSignature(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function verifyMetaSignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
  if (!signature || !appSecret) return false;
  return safeEqual(signature, metaSignature(rawBody, appSecret));
}

function timestampToIso(value: string | undefined): string | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function statusEventKey(status: z.infer<typeof statusSchema>): string {
  const timestamp = status.timestamp || sha256Hex(stableJson(status)).slice(0, 24);
  return `meta:whatsapp_status:${status.id}:${status.status}:${timestamp}`;
}

export function extractMetaStatuses(payload: unknown): ParsedMetaStatus[] {
  const root = payload as { entry?: Array<{ changes?: Array<{ value?: { statuses?: unknown[] } }> }> };
  const statuses: ParsedMetaStatus[] = [];
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      for (const status of change.value?.statuses || []) {
        const parsed = statusSchema.safeParse(status);
        if (!parsed.success) continue;
        statuses.push({
          eventKey: statusEventKey(parsed.data),
          providerMessageId: parsed.data.id,
          providerStatus: parsed.data.status,
          providerTimestamp: timestampToIso(parsed.data.timestamp),
          recipientId: parsed.data.recipient_id || '',
          rawStatus: parsed.data,
        });
      }
    }
  }
  return statuses;
}

export interface ParsedMetaMessage {
  eventKey: string;
  phoneNumberId: string;
  metaMessageId: string;
  from: string;
  messageType: string;
  messageText: string;
  messageOptionId: string;
  receivedAt: string | null;
  profileName: string;
  rawMessage: Record<string, unknown>;
}

function messageTextAndOption(message: z.infer<typeof messageSchema>): { messageText: string; messageOptionId: string } {
  if (message.type === 'text') return { messageText: message.text?.body || '', messageOptionId: '' };
  if (message.type === 'button') return { messageText: message.button?.text || '', messageOptionId: message.button?.payload || '' };
  const button = message.interactive?.button_reply;
  if (button) return { messageText: button.title, messageOptionId: button.id };
  const list = message.interactive?.list_reply;
  if (list) return { messageText: list.title, messageOptionId: list.id };
  return { messageText: '', messageOptionId: '' };
}

export function extractMetaMessages(payload: unknown): ParsedMetaMessage[] {
  const root = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          messages?: unknown[];
        };
      }>;
    }>;
  };
  const messages: ParsedMetaMessage[] = [];
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id || '';
      const contacts = change.value?.contacts || [];
      for (const message of change.value?.messages || []) {
        const parsed = messageSchema.safeParse(message);
        if (!parsed.success) continue;
        const text = messageTextAndOption(parsed.data);
        const contact = contacts.find((candidate) => candidate.wa_id === parsed.data.from) || contacts[0];
        messages.push({
          eventKey: `meta:whatsapp_message:${parsed.data.id}`,
          phoneNumberId,
          metaMessageId: parsed.data.id,
          from: parsed.data.from.startsWith('+') ? parsed.data.from : `+${parsed.data.from}`,
          messageType: parsed.data.type,
          messageText: text.messageText,
          messageOptionId: text.messageOptionId,
          receivedAt: timestampToIso(parsed.data.timestamp),
          profileName: contact?.profile?.name || '',
          rawMessage: parsed.data,
        });
      }
    }
  }
  return messages;
}

function mapMessageState(providerStatus: string): 'sent' | 'delivered' | 'read' | 'failed' | 'delivery_unknown' {
  if (providerStatus === 'sent') return 'sent';
  if (providerStatus === 'delivered') return 'delivered';
  if (providerStatus === 'read') return 'read';
  if (providerStatus === 'failed') return 'failed';
  return 'delivery_unknown';
}

export class MetaStatusWebhookService {
  private readonly env = getEnv();

  constructor(private readonly inbox = new InboxRepository()) {}

  async receive(input: {
    rawBody: Buffer;
    signature: string;
    headers: Record<string, unknown>;
  }): Promise<MetaWebhookReceiptResult> {
    if (!this.env.META_APP_SECRET) throw Object.assign(new Error('meta_app_secret_missing'), { statusCode: 503 });
    if (!verifyMetaSignature(input.rawBody, input.signature, this.env.META_APP_SECRET)) {
      throw Object.assign(new Error('invalid_meta_signature'), { statusCode: 401 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString('utf8')) as unknown;
    } catch {
      throw Object.assign(new Error('invalid_meta_json'), { statusCode: 400 });
    }
    const statuses = extractMetaStatuses(payload);
    const messages = extractMetaMessages(payload);
    if (statuses.length === 0 && messages.length === 0) {
      const receipt = await this.inbox.receive({
        provider: 'meta',
        eventType: 'whatsapp.webhook_ignored',
        rawBody: input.rawBody,
        headers: input.headers,
        payload: { webhookType: 'whatsapp.webhook_ignored', payload },
        signatureValid: true,
      });
      return { received: 1, duplicates: receipt.duplicate ? 1 : 0 };
    }

    let duplicates = 0;
    for (const message of messages) {
      const receipt = await this.inbox.receive({
        provider: 'meta',
        eventType: 'whatsapp.message_received',
        externalEventId: message.eventKey,
        rawBody: input.rawBody,
        headers: input.headers,
        payload: {
          webhookType: 'whatsapp.message_received',
          phoneNumberId: message.phoneNumberId,
          metaMessageId: message.metaMessageId,
          from: message.from,
          messageType: message.messageType,
          messageText: message.messageText,
          messageOptionId: message.messageOptionId,
          receivedAt: message.receivedAt,
          profileName: message.profileName,
          rawMessage: message.rawMessage,
        },
        signatureValid: true,
        aggregateKey: message.from,
      });
      if (receipt.duplicate) duplicates += 1;
    }
    for (const status of statuses) {
      const receipt = await this.inbox.receive({
        provider: 'meta',
        eventType: 'whatsapp.message_status',
        externalEventId: status.eventKey,
        rawBody: input.rawBody,
        headers: input.headers,
        payload: {
          webhookType: 'whatsapp.message_status',
          eventKey: status.eventKey,
          providerMessageId: status.providerMessageId,
          providerStatus: status.providerStatus,
          providerTimestamp: status.providerTimestamp,
          recipientId: status.recipientId,
          rawStatus: status.rawStatus,
        },
        signatureValid: true,
        aggregateKey: status.providerMessageId,
      });
      if (receipt.duplicate) duplicates += 1;
    }
    return { received: statuses.length + messages.length, duplicates };
  }
}

export class MetaStatusProcessor {
  constructor(private readonly audit = new AuditRepository()) {}

  async process(event: ClaimedInboxEvent): Promise<InboxProcessingResult> {
    if (!['meta', 'n8n'].includes(event.provider) || event.eventType !== 'whatsapp.message_status') {
      return { outcome: 'ignored', reason: `unsupported_inbox_event:${event.provider}:${event.eventType}` };
    }
    const parsed = storedStatusSchema.safeParse(event.payload);
    if (!parsed.success) {
      return { outcome: 'dead_lettered', reason: `invalid_meta_status_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }
    const status = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const message = await client.query<{ message_id: string; client_id: string }>(
        `SELECT message_id, client_id
         FROM app.messages
         WHERE provider_message_id=$1
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [status.providerMessageId],
      );
      const row = message.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { outcome: 'retryable', error: `message_not_found_for_provider_status:${status.providerMessageId}` };
      }
      const payloadHash = sha256Hex(stableJson(status.rawStatus));
      await client.query(
        `INSERT INTO app.message_delivery_events
          (message_id, client_id, provider_message_id, provider_status, provider_timestamp,
           event_key, payload_hash, raw_payload)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb)
         ON CONFLICT (client_id, event_key) WHERE event_key <> '' DO NOTHING`,
        [
          row.message_id,
          row.client_id,
          status.providerMessageId,
          status.providerStatus,
          status.providerTimestamp,
          status.eventKey,
          payloadHash,
          JSON.stringify(status.rawStatus),
        ],
      );
      await client.query(
        `UPDATE app.messages
         SET state=$2
         WHERE message_id=$1`,
        [row.message_id, mapMessageState(status.providerStatus)],
      );
      await this.audit.record(client, {
        eventType: 'message.delivery_status_received',
        actorType: 'external_user',
        actorId: event.provider,
        aggregateType: 'message',
        aggregateId: row.message_id,
        correlationId: event.dedupeKey,
        causationId: event.inboxEventId,
        payload: {
          provider: 'meta',
          source: event.provider,
          providerStatus: status.providerStatus,
          providerMessageId: status.providerMessageId,
        },
        after: {
          state: mapMessageState(status.providerStatus),
        },
      });
      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
