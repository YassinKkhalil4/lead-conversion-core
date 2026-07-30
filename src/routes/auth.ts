import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';

function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireSharedSecret(request: FastifyRequest): void {
  const value = String(request.headers['x-edge-secret'] || '');
  if (!safeEqual(value, getEnv().EDGE_SHARED_SECRET)) {
    const error = new Error('Unauthorized');
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
}

export function requireInternalSecret(request: FastifyRequest): void {
  const value = String(request.headers['x-internal-secret'] || '');
  if (!safeEqual(value, getEnv().EDGE_INTERNAL_SECRET)) {
    const error = new Error('Unauthorized');
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
}
