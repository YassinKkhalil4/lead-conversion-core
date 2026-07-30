import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ShadowEvaluator } from '../services/shadow-evaluator.js';
import { requireSharedSecret } from './auth.js';

const inputSchema = z.object({
  eventId: z.string().min(1).max(255),
  metaMessageId: z.string().min(1).max(255),
  clientRecordId: z.string().min(1).max(64),
  clientId: z.string().max(255).optional(),
  phoneNormalized: z.string().min(5).max(32),
  leadRecordId: z.string().min(1).max(64),
  leadId: z.string().max(255).optional(),
  leadName: z.string().max(500).optional(),
  companyName: z.string().max(500).optional(),
  projectName: z.string().max(500).optional(),
  projectRecordId: z.string().max(64).optional(),
  messageText: z.string().max(5000).optional(),
  messageOptionId: z.string().max(255).optional(),
  preferredLanguage: z.enum(['Arabic', 'English', '']).optional(),
  currentStage: z.string().max(255).optional(),
  currentQuestionKey: z.string().max(255).optional(),
  answers: z.record(z.string()).optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
  status: z.string().max(255).optional(),
  humanTakeover: z.boolean().optional(),
  stopFollowUp: z.boolean().optional(),
  closedStatus: z.string().max(255).optional(),
  appointmentStatus: z.string().max(255).optional(),
  assignedSalespersonRecordId: z.string().max(64).optional(),
  assignedSalespersonPhone: z.string().max(32).optional(),
  lastInboundAt: z.string().datetime().optional(),
  stateAuthority: z.enum(['legacy', 'edge']).optional(),
  receivedAt: z.string().datetime().optional(),
  legacyExpected: z.record(z.unknown()).optional(),
});

export async function shadowRoutes(app: FastifyInstance): Promise<void> {
  const evaluator = new ShadowEvaluator();

  app.post('/v1/shadow/evaluate', async (request: FastifyRequest, reply: FastifyReply) => {
    requireSharedSecret(request);
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_request', issues: parsed.error.issues };
    }
    const result = await evaluator.evaluate(parsed.data);
    return { ok: true, mode: 'shadow', ...result };
  });
}
