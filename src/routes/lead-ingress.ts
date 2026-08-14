import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InboxRepository, stableJson } from '../infrastructure/runtime.js';
import { verifyMetaSignature } from '../services/meta-status-webhook-service.js';
import { requireSharedSecret } from './auth.js';
import { getEnv } from '../config/env.js';

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

function publicHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    'content-type': request.headers['content-type'] || '',
    'user-agent': request.headers['user-agent'] || '',
    'x-hub-signature-256': request.headers['x-hub-signature-256'] ? 'present' : '',
  };
}

function rateLimitConfig() {
  const env = getEnv();
  return {
    rateLimit: {
      max: env.PUBLIC_INGRESS_RATE_LIMIT_MAX,
      timeWindow: env.PUBLIC_INGRESS_RATE_LIMIT_WINDOW_MS,
    },
  };
}

export async function leadIngressRoutes(app: FastifyInstance): Promise<void> {
  const inbox = new InboxRepository();

  async function receiveOnly(input: {
    request: FastifyRequest;
    reply: FastifyReply;
    provider: 'website' | 'facebook';
    eventType: string;
    externalEventId?: string;
    signatureValid: boolean;
    rawBody?: Buffer;
  }): Promise<Record<string, unknown>> {
    if (!getEnv().DIRECT_LEAD_INGRESS_ENABLED) {
      input.reply.code(503);
      return { ok: false, error: 'direct_lead_ingress_disabled' };
    }
    if (input.provider === 'website') requireSharedSecret(input.request);
    const payload = (input.request.body || {}) as Record<string, unknown>;
    const receiptInput = {
      provider: input.provider,
      eventType: input.eventType,
      rawBody: input.rawBody || Buffer.from(stableJson(payload)),
      headers: publicHeaders(input.request),
      payload,
      signatureValid: input.signatureValid,
      aggregateKey: input.externalEventId || '',
    };
    const receipt = await inbox.receive(input.externalEventId
      ? { ...receiptInput, externalEventId: input.externalEventId }
      : receiptInput);
    return { ok: true, received: 1, inboxEventId: receipt.inboxEventId, duplicate: receipt.duplicate };
  }

  app.post('/webhooks/leads/website', { config: rateLimitConfig() }, async (request: FastifyRequest, reply: FastifyReply) => {
    const externalEventId = String((request.body as Record<string, unknown> | null)?.eventId || '');
    return receiveOnly({
      request,
      reply,
      provider: 'website',
      eventType: 'lead.created',
      externalEventId,
      signatureValid: true,
    });
  });

  app.post('/webhooks/leads/facebook', { config: rateLimitConfig() }, async (request: RawBodyRequest, reply: FastifyReply) => {
    const env = getEnv();
    if (!env.DIRECT_LEAD_INGRESS_ENABLED) {
      reply.code(503);
      return { ok: false, error: 'direct_lead_ingress_disabled' };
    }
    const rawBody = request.rawBody;
    if (!rawBody) {
      reply.code(400);
      return { ok: false, error: 'raw_body_missing' };
    }
    const signatureValid = verifyMetaSignature(rawBody, String(request.headers['x-hub-signature-256'] || ''), env.META_APP_SECRET);
    if (!signatureValid) {
      reply.code(403);
      return { ok: false, error: 'invalid_facebook_webhook_signature' };
    }
    const externalEventId = String((request.body as Record<string, unknown> | null)?.leadgen_id || '');
    return receiveOnly({
      request,
      reply,
      provider: 'facebook',
      eventType: 'leadgen.created',
      externalEventId,
      signatureValid,
      rawBody,
    });
  });
}
