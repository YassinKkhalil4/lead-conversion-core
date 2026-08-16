import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../services/dashboard/password.js';
import type { DashboardSessionService } from '../../services/dashboard/session-service.js';
import type { DashboardUserService } from '../../services/dashboard/user-service.js';
import { unauthorized } from '../../services/dashboard/types.js';
import {
  clearedSessionCookie,
  clientIpOf,
  parseOrThrow,
  readCookie,
  requireSession,
  requireUser,
  sessionCookie,
  userAgentOf,
} from './context.js';

const loginSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  clientKey: z.string().min(1).max(200).optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export async function dashboardAuthRoutes(
  app: FastifyInstance,
  deps: { sessions: DashboardSessionService; users: DashboardUserService },
): Promise<void> {
  app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseOrThrow(loginSchema, request.body);
    const result = await deps.sessions.login({
      email: body.email,
      password: body.password,
      ...(body.clientKey ? { clientKey: body.clientKey } : {}),
      ipAddress: clientIpOf(request),
      userAgent: userAgentOf(request),
    });
    reply.header('set-cookie', sessionCookie(result.token, result.expiresAt));
    return {
      ok: true,
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
    };
  });

  app.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request);
    const revoked = await deps.sessions.revoke(session.sessionId, session.user.userId);
    reply.header('set-cookie', clearedSessionCookie());
    return { ok: true, revoked };
  });

  app.get('/api/auth/me', async (request: FastifyRequest) => {
    const session = requireSession(request);
    return { ok: true, user: session.user, expiresAt: session.expiresAt };
  });

  app.post('/api/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request);
    const refreshed = await deps.sessions.refresh(session.sessionId);
    if (!refreshed) throw unauthorized('session_not_refreshable');
    // The opaque token never changes; only the expiry moves forward. Cookie
    // clients get a refreshed cookie, bearer clients just keep their token.
    const cookieToken = readCookie(request.headers.cookie, getEnv().DASHBOARD_SESSION_COOKIE_NAME);
    if (cookieToken) {
      reply.header('set-cookie', sessionCookie(cookieToken, refreshed.expiresAt));
    }
    return { ok: true, expiresAt: refreshed.expiresAt, user: refreshed.user };
  });

  app.post('/api/auth/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request);
    const body = parseOrThrow(passwordChangeSchema, request.body);
    await deps.users.changeOwnPassword({
      user,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    // Every session for this user is revoked, including this one.
    reply.header('set-cookie', clearedSessionCookie());
    return { ok: true, sessionsRevoked: true };
  });
}
