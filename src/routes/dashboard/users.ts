import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../services/dashboard/password.js';
import type { DashboardUserService } from '../../services/dashboard/user-service.js';
import { parseOrThrow, requireRole } from './context.js';

const ADMIN_ONLY = ['admin'] as const;

const idParamsSchema = z.object({ id: z.string().uuid() });

const createSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  name: z.string().min(1).max(200),
  role: z.enum(['admin', 'manager', 'salesperson']),
  salespersonId: z.string().uuid().nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    role: z.enum(['admin', 'manager', 'salesperson']).optional(),
    active: z.boolean().optional(),
    salespersonId: z.string().uuid().nullable().optional(),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no_fields_to_update' });

/**
 * Accounts are created by admins only; there is no self-service signup.
 */
export async function dashboardUserRoutes(
  app: FastifyInstance,
  deps: { users: DashboardUserService },
): Promise<void> {
  app.get('/api/users', async (request: FastifyRequest) => {
    const actor = requireRole(request, ADMIN_ONLY);
    const users = await deps.users.list(actor.clientId);
    return { ok: true, users };
  });

  app.post('/api/users', async (request: FastifyRequest) => {
    const actor = requireRole(request, ADMIN_ONLY);
    const body = parseOrThrow(createSchema, request.body);
    const user = await deps.users.create({
      clientId: actor.clientId,
      email: body.email,
      password: body.password,
      name: body.name,
      role: body.role,
      salespersonId: body.salespersonId ?? null,
      actorId: actor.userId,
    });
    return { ok: true, user };
  });

  app.patch('/api/users/:id', async (request: FastifyRequest) => {
    const actor = requireRole(request, ADMIN_ONLY);
    const params = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(updateSchema, request.body);
    const user = await deps.users.update({
      clientId: actor.clientId,
      userId: params.id,
      actorId: actor.userId,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.role === undefined ? {} : { role: body.role }),
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.salespersonId === undefined ? {} : { salespersonId: body.salespersonId }),
      ...(body.password === undefined ? {} : { password: body.password }),
    });
    return { ok: true, user };
  });
}
