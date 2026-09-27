import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';
import { WaitlistService, waitlistSchema } from '../services/waitlist-service.js';
import { browserSubmissionHeaders, publicRateLimit } from './public-ingress.js';

/**
 * Reached same-origin as https://kadensio.com/api/waitlist, proxied by Caddy to
 * this path. Registered under /public/ rather than /api/ because /api/ on this
 * service is the session-authenticated dashboard surface, and a genuinely
 * anonymous route should not sit inside it.
 */
export const WAITLIST_ROUTE_PATH = '/public/waitlist';

export async function waitlistRoutes(app: FastifyInstance): Promise<void> {
  const service = new WaitlistService();

  app.post(WAITLIST_ROUTE_PATH, { config: publicRateLimit() }, async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const env = getEnv();
    if (!env.WAITLIST_SIGNUP_ENABLED) {
      reply.code(503);
      return { ok: false, error: 'waitlist_signup_disabled' };
    }

    const parsed = waitlistSchema(env.WAITLIST_SIGNUP_MESSAGE_MAX_LENGTH)
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: 'invalid_waitlist_submission',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }

    const result = await service.submit({
      submission: parsed.data,
      ipAddress: String(request.ip || request.socket.remoteAddress || 'unknown'),
      requestHeaders: browserSubmissionHeaders(request),
      correlationId: String(request.id || ''),
    });

    if (result.outcome === 'rate_limited') {
      reply.code(429);
      reply.header('retry-after', String(result.retryAfterSeconds));
      return { ok: false, error: 'waitlist_rate_limited' };
    }

    // A discarded honeypot submission is answered exactly as an accepted one:
    // same status, same body, no timing branch worth measuring. Nothing about
    // the row, the email, or whether it was a repeat is echoed back.
    return { ok: true };
  });
}
