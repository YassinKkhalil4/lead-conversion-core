import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';
import { InboxRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';
import { MessageRequestService, type MessageRequestInput } from '../services/message-request-service.js';
import { requireInternalSecret } from './auth.js';

const optionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const payloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1) }),
  z.object({ kind: z.literal('buttons'), text: z.string().min(1), options: z.array(optionSchema).min(1).max(3) }),
  z.object({ kind: z.literal('list'), text: z.string().min(1), buttonText: z.string().min(1), options: z.array(optionSchema).min(1).max(10) }),
  z.object({ kind: z.literal('template'), templateName: z.string().min(1), languageCode: z.string().min(2), components: z.array(z.record(z.unknown())).optional().default([]) }),
]);

const sendSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientRecordId: z.string().min(1).optional(),
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  requestKey: z.string().min(1).optional(),
  sourceEventId: z.string().min(1).optional(),
  phoneNumberId: z.string().optional().default(''),
  toE164: z.string().min(5).optional(),
  phoneNormalized: z.string().min(5).optional(),
  text: z.string().min(1).optional(),
  payload: payloadSchema.optional(),
  conversationWindowExpiresAt: z.string().datetime().optional(),
});

const statusSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientRecordId: z.string().min(1).optional(),
  providerMessageId: z.string().min(1),
  status: z.string().min(1),
  providerTimestamp: z.string().datetime().optional(),
  recipientId: z.string().optional().default(''),
  sourceEventId: z.string().min(1).optional(),
  rawPayload: z.record(z.unknown()).optional().default({}),
});

const inboundSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientRecordId: z.string().min(1).optional(),
  phoneNumberId: z.string().min(1),
  fromE164: z.string().min(5).optional(),
  phoneNormalized: z.string().min(5).optional(),
  metaMessageId: z.string().min(1).optional(),
  sourceEventId: z.string().min(1).optional(),
  messageType: z.string().min(1).optional().default('text'),
  messageText: z.string().optional().default(''),
  text: z.string().optional(),
  messageOptionId: z.string().optional().default(''),
  receivedAt: z.string().datetime().optional(),
  profileName: z.string().optional().default(''),
  rawPayload: z.record(z.unknown()).optional().default({}),
});

async function resolveClientId(input: { clientId?: string; clientRecordId?: string }): Promise<string> {
  if (input.clientId) return input.clientId;
  if (!input.clientRecordId) throw Object.assign(new Error('client_identity_required'), { statusCode: 400 });
  const result = await pool.query<{ client_id: string }>(
    `SELECT client_id
     FROM app.clients
     WHERE legacy_airtable_id=$1 OR client_key=$1
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.clientRecordId],
  );
  const clientId = result.rows[0]?.client_id;
  if (!clientId) throw Object.assign(new Error('client_not_found'), { statusCode: 404 });
  return clientId;
}

function clientIdentity(input: { clientId?: string | undefined; clientRecordId?: string | undefined }): { clientId?: string; clientRecordId?: string } {
  const identity: { clientId?: string; clientRecordId?: string } = {};
  if (input.clientId) identity.clientId = input.clientId;
  if (input.clientRecordId) identity.clientRecordId = input.clientRecordId;
  return identity;
}

function compatEnabled(reply: FastifyReply): boolean {
  if (getEnv().N8N_COMPAT_ROUTES_ENABLED) return true;
  reply.code(503);
  return false;
}

function statusEventKey(input: z.output<typeof statusSchema>): string {
  const timestamp = input.providerTimestamp || input.sourceEventId || sha256Hex(stableJson(input.rawPayload)).slice(0, 24);
  return `n8n:whatsapp_status:${input.providerMessageId}:${input.status}:${timestamp}`;
}

function inboundEventKey(input: z.output<typeof inboundSchema>): string {
  const stableId = input.metaMessageId || input.sourceEventId || sha256Hex(stableJson({
    phoneNumberId: input.phoneNumberId,
    from: input.fromE164 || input.phoneNormalized || '',
    messageType: input.messageType,
    messageText: input.messageText || input.text || '',
    messageOptionId: input.messageOptionId,
    receivedAt: input.receivedAt || '',
    rawPayload: input.rawPayload,
  })).slice(0, 32);
  return `n8n:whatsapp_message:${stableId}`;
}

export async function n8nCompatRoutes(app: FastifyInstance): Promise<void> {
  const messageRequests = new MessageRequestService();
  const inbox = new InboxRepository();

  app.post('/compat/n8n/messages/whatsapp/send', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    if (!compatEnabled(reply)) return { ok: false, error: 'n8n_compat_routes_disabled' };
    const parsed = sendSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const payload = body.payload || (body.text ? { kind: 'text' as const, text: body.text } : undefined);
    if (!payload) {
      reply.code(400);
      return { ok: false, error: 'message_payload_required' };
    }
    const clientId = await resolveClientId(clientIdentity(body));
    const input: MessageRequestInput = {
      clientId,
      requestKey: body.requestKey || body.sourceEventId || `n8n:${sha256Hex(stableJson(body)).slice(0, 24)}`,
      phoneNumberId: body.phoneNumberId,
      toE164: body.toE164 || body.phoneNormalized || '',
      payload,
      actorId: 'n8n',
    };
    if (body.contactId) input.contactId = body.contactId;
    if (body.leadId) input.leadId = body.leadId;
    if (body.conversationId) input.conversationId = body.conversationId;
    if (body.conversationWindowExpiresAt) input.conversationWindowExpiresAt = body.conversationWindowExpiresAt;
    const result = await messageRequests.requestWhatsAppSend(input);
    return { ok: true, ...result };
  });

  app.post('/compat/n8n/messages/whatsapp/status', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    if (!compatEnabled(reply)) return { ok: false, error: 'n8n_compat_routes_disabled' };
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const clientId = await resolveClientId(clientIdentity(body));
    const eventKey = statusEventKey(body);
    const payload = {
      webhookType: 'whatsapp.message_status',
      eventKey,
      providerMessageId: body.providerMessageId,
      providerStatus: body.status,
      providerTimestamp: body.providerTimestamp || null,
      recipientId: body.recipientId,
      rawStatus: { ...body.rawPayload, source: 'n8n', status: body.status },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const receipt = await inbox.receive({
      provider: 'n8n',
      eventType: 'whatsapp.message_status',
      externalEventId: eventKey,
      rawBody,
      headers: { 'x-internal-secret': 'present' },
      payload,
      signatureValid: true,
      aggregateKey: body.providerMessageId,
    });
    return { ok: true, received: 1, duplicate: receipt.duplicate, inboxEventId: receipt.inboxEventId, clientId };
  });

  app.post('/compat/n8n/messages/whatsapp/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    if (!compatEnabled(reply)) return { ok: false, error: 'n8n_compat_routes_disabled' };
    const parsed = inboundSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const clientId = await resolveClientId(clientIdentity(body));
    const from = body.fromE164 || body.phoneNormalized || '';
    if (!from) {
      reply.code(400);
      return { ok: false, error: 'from_phone_required' };
    }
    const eventKey = inboundEventKey(body);
    const metaMessageId = body.metaMessageId || body.sourceEventId || eventKey;
    const payload = {
      webhookType: 'whatsapp.message_received',
      phoneNumberId: body.phoneNumberId,
      metaMessageId,
      from,
      messageType: body.messageType,
      messageText: body.messageText || body.text || '',
      messageOptionId: body.messageOptionId,
      receivedAt: body.receivedAt,
      profileName: body.profileName,
      rawMessage: { ...body.rawPayload, source: 'n8n', sourceEventId: body.sourceEventId || '' },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const receipt = await inbox.receive({
      provider: 'n8n',
      eventType: 'whatsapp.message_received',
      externalEventId: eventKey,
      rawBody,
      headers: { 'x-internal-secret': 'present' },
      payload,
      signatureValid: true,
      aggregateKey: from,
    });
    return { ok: true, received: 1, duplicate: receipt.duplicate, inboxEventId: receipt.inboxEventId, clientId };
  });
}
