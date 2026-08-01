import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InboxRepository, stableJson } from '../infrastructure/runtime.js';
import { requireSharedSecret } from './auth.js';
import { getEnv } from '../config/env.js';

function publicHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    'content-type': request.headers['content-type'] || '',
    'user-agent': request.headers['user-agent'] || '',
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
  }): Promise<Record<string, unknown>> {
    requireSharedSecret(input.request);
    if (!getEnv().DIRECT_LEAD_INGRESS_ENABLED) {
      input.reply.code(503);
      return { ok: false, error: 'direct_lead_ingress_disabled' };
    }
    const payload = (input.request.body || {}) as Record<string, unknown>;
    const receiptInput = {
      provider: input.provider,
      eventType: input.eventType,
      rawBody: Buffer.from(stableJson(payload)),
      headers: publicHeaders(input.request),
      payload,
      signatureValid: true,
      aggregateKey: input.externalEventId || '',
    };
    const receipt = await inbox.receive(input.externalEventId
      ? { ...receiptInput, externalEventId: input.externalEventId }
      : receiptInput);
    return { ok: true, received: 1, inboxEventId: receipt.inboxEventId, duplicate: receipt.duplicate };
  }

  app.post('/webhooks/leads/website', async (request: FastifyRequest, reply: FastifyReply) => {
    const externalEventId = String((request.body as Record<string, unknown> | null)?.eventId || '');
    return receiveOnly({
      request,
      reply,
      provider: 'website',
      eventType: 'lead.created',
      externalEventId,
    });
  });

  app.post('/webhooks/leads/facebook', async (request: FastifyRequest, reply: FastifyReply) => {
    const externalEventId = String((request.body as Record<string, unknown> | null)?.leadgen_id || '');
    return receiveOnly({
      request,
      reply,
      provider: 'facebook',
      eventType: 'leadgen.created',
      externalEventId,
    });
  });
}
