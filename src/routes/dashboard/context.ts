import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeAny, z } from 'zod';
import { getEnv } from '../../config/env.js';
import { DashboardSessionService } from '../../services/dashboard/session-service.js';
import {
  badRequest,
  DashboardHttpError,
  type DashboardRole,
  type DashboardSession,
  type DashboardUser,
  forbidden,
  unauthorized,
} from '../../services/dashboard/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    dashboardSession: DashboardSession | null;
  }
}

const BEARER_PREFIX = 'bearer ';

export function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return '';
}

export function readBearerToken(request: FastifyRequest): string {
  const header = String(request.headers.authorization || '');
  if (header.toLocaleLowerCase().startsWith(BEARER_PREFIX)) {
    return header.slice(BEARER_PREFIX.length).trim();
  }
  return readCookie(request.headers.cookie, getEnv().DASHBOARD_SESSION_COOKIE_NAME);
}

export function sessionCookie(token: string, expiresAt: string): string {
  const env = getEnv();
  const attributes = [
    `${env.DASHBOARD_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (env.DASHBOARD_SESSION_COOKIE_SECURE) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearedSessionCookie(): string {
  const env = getEnv();
  const attributes = [
    `${env.DASHBOARD_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (env.DASHBOARD_SESSION_COOKIE_SECURE) attributes.push('Secure');
  return attributes.join('; ');
}

export function clientIpOf(request: FastifyRequest): string {
  return String(request.ip || request.socket.remoteAddress || 'unknown');
}

export function userAgentOf(request: FastifyRequest): string {
  return String(request.headers['user-agent'] || '');
}

/**
 * Resolves the session for every dashboard request. Routes that are reachable
 * without a session opt out by listing themselves here; everything else fails
 * closed in `requireSession`.
 */
export function createAuthHook(sessions: DashboardSessionService) {
  const publicPaths = new Set(['/api/auth/login']);
  return async function resolveSession(request: FastifyRequest): Promise<void> {
    request.dashboardSession = null;
    const path = request.url.split('?')[0] || '';
    if (publicPaths.has(path)) return;
    const token = readBearerToken(request);
    if (!token) return;
    request.dashboardSession = await sessions.resolve(token);
  };
}

export function requireSession(request: FastifyRequest): DashboardSession {
  const session = request.dashboardSession;
  if (!session) throw unauthorized();
  return session;
}

export function requireUser(request: FastifyRequest): DashboardUser {
  return requireSession(request).user;
}

export function requireRole(request: FastifyRequest, roles: readonly DashboardRole[]): DashboardUser {
  const user = requireUser(request);
  if (!roles.includes(user.role)) throw forbidden('role_not_permitted');
  return user;
}

export function parseOrThrow<T extends ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('validation_failed', { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function sendDashboardError(error: unknown, request: FastifyRequest, reply: FastifyReply): unknown {
  if (error instanceof DashboardHttpError) {
    if (error.statusCode >= 500) request.log.error({ error }, 'Dashboard request failed');
    reply.code(error.statusCode);
    if (error.statusCode === 429 && typeof error.details.retryAfterSeconds === 'number') {
      reply.header('retry-after', String(error.details.retryAfterSeconds));
    }
    return { ok: false, error: error.message, ...error.details };
  }
  request.log.error({ error }, 'Dashboard request failed');
  const statusCode = Number((error as { statusCode?: number })?.statusCode || 500);
  if (statusCode >= 500) {
    reply.code(500);
    return { ok: false, error: 'internal_error' };
  }
  reply.code(statusCode);
  return { ok: false, error: error instanceof Error ? error.message : 'request_failed' };
}
