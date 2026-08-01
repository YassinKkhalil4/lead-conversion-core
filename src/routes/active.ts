import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { ActiveTurnService } from '../services/active-turn-service.js';
import { requireSharedSecret } from './auth.js';

const schema = z.object({
  eventId: z.string().min(1).max(255),
  metaMessageId: z.string().min(1).max(255),
  phoneNumberId: z.string().min(1).max(255),
  phoneNormalized: z.string().min(5).max(32),
  profileName: z.string().max(500).optional(),
  messageType: z.string().min(1).max(64),
  messageText: z.string().max(5000).optional(),
  messageOptionId: z.string().max(255).optional(),
  receivedAt: z.string().datetime().optional(),
});

export async function activeRoutes(app: FastifyInstance): Promise<void> {
  const service = new ActiveTurnService();
  app.post('/v1/turn', async (request: FastifyRequest, reply: FastifyReply) => {
    requireSharedSecret(request);
    if (!getEnv().ACTIVE_TURN_COMPAT_ENABLED) {
      reply.code(503);
      return { ok: false, handled: false, error: 'active_turn_compat_disabled' };
    }
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, handled: false, error: 'invalid_request', issues: parsed.error.issues };
    }
    const result = await service.handle(parsed.data);
    return { ok: true, mode: 'active', ...result };
  });
}
