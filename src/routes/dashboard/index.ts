import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DashboardSessionService } from '../../services/dashboard/session-service.js';
import { DashboardUserService } from '../../services/dashboard/user-service.js';
import { dashboardAuthRoutes } from './auth.js';
import { createAuthHook, sendDashboardError } from './context.js';
import { dashboardUserRoutes } from './users.js';

/**
 * Session-authenticated dashboard API. Registered as one encapsulated plugin so
 * the auth hook and the error serialiser apply to these routes only and leave
 * the machine-to-machine surface untouched.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const sessions = new DashboardSessionService();
  const users = new DashboardUserService();

  app.decorateRequest('dashboardSession', null);
  app.addHook('preHandler', createAuthHook(sessions));
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) =>
    sendDashboardError(error, request, reply),
  );

  await dashboardAuthRoutes(app, { sessions, users });
  await dashboardUserRoutes(app, { users });
}
