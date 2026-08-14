import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { MetaStatusWebhookService } from '../services/meta-status-webhook-service.js';

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

const challengeSchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});


function rateLimitConfig() {
  const env = getEnv();
  return {
    rateLimit: {
      max: env.PUBLIC_INGRESS_RATE_LIMIT_MAX,
      timeWindow: env.PUBLIC_INGRESS_RATE_LIMIT_WINDOW_MS,
    },
  };
}

function publicHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    'content-type': request.headers['content-type'] || '',
    'user-agent': request.headers['user-agent'] || '',
    'x-hub-signature-256': request.headers['x-hub-signature-256'] ? 'present' : '',
  };
}

export async function metaWebhookRoutes(app: FastifyInstance): Promise<void> {
  const service = new MetaStatusWebhookService();

  app.get('/webhooks/meta/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    const env = getEnv();
    if (!env.DIRECT_META_WEBHOOK_ENABLED) {
      reply.code(503);
      return { ok: false, error: 'direct_meta_webhook_disabled' };
    }
    if (!env.META_WEBHOOK_VERIFY_TOKEN) {
      reply.code(503);
      return { ok: false, error: 'meta_webhook_verify_token_missing' };
    }
    const parsed = challengeSchema.safeParse(request.query);
    if (!parsed.success || parsed.data['hub.mode'] !== 'subscribe' || parsed.data['hub.verify_token'] !== env.META_WEBHOOK_VERIFY_TOKEN) {
      reply.code(403);
      return { ok: false, error: 'invalid_meta_webhook_challenge' };
    }
    reply.type('text/plain');
    return parsed.data['hub.challenge'] || '';
  });

  app.post('/webhooks/meta/whatsapp', { config: rateLimitConfig() }, async (request: RawBodyRequest, reply: FastifyReply) => {
    if (!getEnv().DIRECT_META_WEBHOOK_ENABLED) {
      reply.code(503);
      return { ok: false, error: 'direct_meta_webhook_disabled' };
    }
    const rawBody = request.rawBody;
    if (!rawBody) {
      reply.code(400);
      return { ok: false, error: 'raw_body_missing' };
    }
    try {
      const result = await service.receive({
        rawBody,
        signature: String(request.headers['x-hub-signature-256'] || ''),
        headers: publicHeaders(request),
      });
      return { ok: true, ...result };
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 500);
      if (statusCode < 500) {
        reply.code(statusCode);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      throw error;
    }
  });
}
