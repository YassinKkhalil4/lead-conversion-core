import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DashboardLeadActionService } from '../../services/dashboard/lead-action-service.js';
import type { DashboardLeadDetailService } from '../../services/dashboard/lead-detail-service.js';
import { DashboardLeadListService, LEAD_SORT_COLUMNS } from '../../services/dashboard/lead-list-service.js';
import { scopeFor } from '../../services/dashboard/types.js';
import { parseOrThrow, requireUser } from './context.js';

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const booleanFlag = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((value) => value === true || value === 'true');

const listQuerySchema = z.object({
  status: csv.optional(),
  temperature: csv.optional(),
  source: csv.optional(),
  assigned_to: z.union([z.literal('me'), z.literal('unassigned'), z.string().uuid()]).optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
  q: z.string().min(1).max(200).optional(),
  unacknowledged: booleanFlag.optional(),
  sort: z.enum(Object.keys(LEAD_SORT_COLUMNS) as [string, ...string[]]).default('created_at'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const leadParamsSchema = z.object({ id: z.string().uuid() });

const messageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const closeSchema = z.object({ reason: z.string().min(1).max(200) });
const stopFollowUpSchema = z.object({ reason: z.string().min(1).max(200).default('stopped_from_dashboard') });
const takeoverSchema = z.object({ enabled: z.boolean().default(true) });

export const PIPELINE_STAGES = [
  'new',
  'in_progress',
  'site_visit_scheduled',
  'closed_won',
  'closed_lost',
  'ghosted',
] as const;

const stageSchema = z.object({ stage: z.enum(PIPELINE_STAGES) });

const replySchema = z.object({
  requestKey: z.string().min(8).max(200),
  payload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string().min(1).max(4000) }),
    z.object({
      kind: z.literal('template'),
      templateName: z.string().min(1).max(200),
      languageCode: z.string().min(2).max(10).default('ar'),
    }),
  ]),
});

export async function dashboardLeadRoutes(
  app: FastifyInstance,
  deps: {
    list: DashboardLeadListService;
    detail: DashboardLeadDetailService;
    actions: DashboardLeadActionService;
  },
): Promise<void> {
  app.get('/api/leads', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const query = parseOrThrow(listQuerySchema, request.query);
    const scope = scopeFor(user);
    if (query.assigned_to === 'me' && !user.salespersonId) {
      // A manager or admin has no salesperson record, so "mine" is empty by
      // definition rather than an error.
      return { ok: true, leads: [], total: 0, limit: query.limit, offset: query.offset };
    }
    const assignedTo = query.assigned_to === 'me' ? user.salespersonId ?? undefined : query.assigned_to;
    const page = await deps.list.list(scope, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.temperature ? { temperature: query.temperature } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(assignedTo ? { assignedTo } : {}),
      ...(query.created_from ? { createdFrom: query.created_from } : {}),
      ...(query.created_to ? { createdTo: query.created_to } : {}),
      ...(query.q ? { search: query.q } : {}),
      ...(query.unacknowledged ? { unacknowledgedOnly: true } : {}),
      sort: query.sort,
      direction: query.direction,
      limit: query.limit,
      offset: query.offset,
    });
    return { ok: true, ...page };
  });

  app.get('/api/leads/:id', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const detail = await deps.detail.detail(scopeFor(user), params.id);
    return { ok: true, ...detail };
  });

  app.get('/api/leads/:id/messages', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const query = parseOrThrow(messageQuerySchema, request.query);
    const scope = scopeFor(user);
    const result = await deps.detail.messages(scope, params.id, query.limit, query.offset);
    return { ok: true, ...result };
  });

  app.post('/api/leads/:id/acknowledge', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const result = await deps.actions.acknowledge(user, scopeFor(user), params.id);
    return { ok: true, ...result };
  });

  app.post('/api/leads/:id/takeover', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const body = parseOrThrow(takeoverSchema, request.body ?? {});
    const result = await deps.actions.takeover(user, scopeFor(user), params.id, body.enabled);
    return { ok: true, ...result };
  });

  app.post('/api/leads/:id/close', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const body = parseOrThrow(closeSchema, request.body);
    const result = await deps.actions.close(user, scopeFor(user), params.id, body.reason);
    return { ok: true, ...result };
  });

  app.post('/api/leads/:id/stop-followup', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const body = parseOrThrow(stopFollowUpSchema, request.body ?? {});
    const result = await deps.actions.stopFollowUp(user, scopeFor(user), params.id, body.reason);
    return { ok: true, ...result };
  });

  app.patch('/api/leads/:id/stage', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const body = parseOrThrow(stageSchema, request.body);
    const result = await deps.actions.setPipelineStage(user, scopeFor(user), params.id, body.stage);
    return { ok: true, ...result };
  });

  app.post('/api/leads/:id/reply', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const params = parseOrThrow(leadParamsSchema, request.params);
    const body = parseOrThrow(replySchema, request.body);
    const result = await deps.actions.reply(user, scopeFor(user), {
      leadId: params.id,
      requestKey: body.requestKey,
      payload: body.payload,
    });
    return { ok: true, ...result };
  });
}
