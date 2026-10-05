import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DashboardLeadActionService } from '../../services/dashboard/lead-action-service.js';
import { DashboardReservationService, RESERVATION_STATUSES } from '../../services/dashboard/reservation-service.js';
import { scopeFor } from '../../services/dashboard/types.js';
import { parseOrThrow, requireUser } from './context.js';

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : value.split(',')).map((entry) => entry.trim()).filter(Boolean));

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listQuerySchema = z.object({
  status: csv.pipe(z.array(z.enum(RESERVATION_STATUSES))).optional(),
  from: day.optional(),
  to: day.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const paramsSchema = z.object({ id: z.string().uuid() });
const confirmSchema = z.object({ depositStatus: z.enum(['pending', 'paid', 'waived']).optional() });
const statusSchema = z.object({ status: z.enum(['seated', 'completed', 'no_show']) });

/** Reservations for a hospitality tenant's host dashboard. Scoped exactly as leads are. */
export async function dashboardReservationRoutes(
  app: FastifyInstance,
  deps: { reservations: DashboardReservationService; actions: DashboardLeadActionService },
): Promise<void> {
  app.get('/api/reservations', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const query = parseOrThrow(listQuerySchema, request.query);
    const page = await deps.reservations.list(scopeFor(user), {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      limit: query.limit,
      offset: query.offset,
    });
    return { ok: true, ...page };
  });

  app.get('/api/reservations/:id', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(paramsSchema, request.params);
    return { ok: true, reservation: await deps.reservations.get(scopeFor(user), id) };
  });

  app.post('/api/reservations/:id/confirm', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(paramsSchema, request.params);
    const body = parseOrThrow(confirmSchema, request.body ?? {});
    const result = await deps.reservations.confirm(user, scopeFor(user), id, body.depositStatus ? { depositStatus: body.depositStatus } : {}, deps.actions);
    return { ok: true, ...result };
  });

  app.post('/api/reservations/:id/cancel', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(paramsSchema, request.params);
    const result = await deps.reservations.cancel(user, scopeFor(user), id, deps.actions);
    return { ok: true, ...result };
  });

  app.post('/api/reservations/:id/status', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(paramsSchema, request.params);
    const body = parseOrThrow(statusSchema, request.body);
    return { ok: true, reservation: await deps.reservations.setStatus(user, scopeFor(user), id, body.status) };
  });
}
