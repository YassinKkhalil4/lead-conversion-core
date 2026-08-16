import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DashboardSummaryService } from '../../services/dashboard/summary-service.js';
import { scopeFor } from '../../services/dashboard/types.js';
import { parseOrThrow, requireUser } from './context.js';

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function dashboardSummaryRoutes(
  app: FastifyInstance,
  deps: { summary: DashboardSummaryService },
): Promise<void> {
  app.get('/api/dashboard/summary', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const summary = await deps.summary.summary(scopeFor(user), user.timezone || 'Africa/Cairo');
    return { ok: true, summary };
  });

  app.get('/api/dashboard/activity', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const query = parseOrThrow(activityQuerySchema, request.query);
    const activity = await deps.summary.activity(scopeFor(user), query.limit);
    return { ok: true, activity };
  });
}
