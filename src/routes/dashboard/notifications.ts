import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DashboardNotificationService } from '../../services/dashboard/notification-service.js';
import { parseOrThrow, requireUser } from './context.js';

const listQuerySchema = z.object({
  unread: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

const deviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  token: z.string().min(8).max(4000),
});

const deviceDeleteSchema = z.object({ token: z.string().min(8).max(4000) });

export async function dashboardNotificationRoutes(
  app: FastifyInstance,
  deps: { notifications: DashboardNotificationService },
): Promise<void> {
  app.get('/api/notifications', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const query = parseOrThrow(listQuerySchema, request.query);
    const result = await deps.notifications.list(user, {
      unreadOnly: query.unread === true,
      limit: query.limit,
      offset: query.offset,
    });
    return { ok: true, ...result };
  });

  app.post('/api/notifications/read-all', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const updated = await deps.notifications.markAllRead(user);
    return { ok: true, updated };
  });

  app.post('/api/notifications/:id/read', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(idParamsSchema, request.params);
    const notification = await deps.notifications.markRead(user, params.id);
    return { ok: true, notification };
  });

  app.post('/api/devices', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const body = parseOrThrow(deviceSchema, request.body);
    const device = await deps.notifications.registerDevice(user, body);
    return { ok: true, device };
  });

  app.delete('/api/devices', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const body = parseOrThrow(deviceDeleteSchema, request.body);
    const deactivated = await deps.notifications.deactivateDevice(user, body.token);
    return { ok: true, deactivated };
  });
}
