import type { FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';

/** Per-route rate limit shared by every unauthenticated public endpoint. */
export function publicRateLimit() {
  const env = getEnv();
  return {
    rateLimit: {
      max: env.PUBLIC_INGRESS_RATE_LIMIT_MAX,
      timeWindow: env.PUBLIC_INGRESS_RATE_LIMIT_WINDOW_MS,
    },
  };
}

function baseHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    'content-type': request.headers['content-type'] || '',
    'user-agent': request.headers['user-agent'] || '',
  };
}

/**
 * The only headers persisted with a provider webhook receipt. The signature is
 * recorded as present or absent, never stored.
 */
export function webhookReceiptHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    ...baseHeaders(request),
    'x-hub-signature-256': request.headers['x-hub-signature-256'] ? 'present' : '',
  };
}

/**
 * The only headers persisted with a browser form submission. The request body
 * is never logged and never lands here.
 */
export function browserSubmissionHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    ...baseHeaders(request),
    'accept-language': request.headers['accept-language'] || '',
  };
}
