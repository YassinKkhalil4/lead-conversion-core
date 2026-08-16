import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DashboardDirectoryService } from '../../services/dashboard/directory-service.js';
import { parseOrThrow, requireRole, requireUser } from './context.js';

const MANAGERS = ['admin', 'manager'] as const;

const includeInactiveSchema = z.object({
  include_inactive: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const stringList = z.array(z.string().min(1).max(120)).max(50);

const salespersonCreateSchema = z.object({
  name: z.string().min(1).max(200),
  phoneE164: z.string().min(5).max(30),
  email: z.string().max(320).default(''),
  unitSpecialties: stringList.default([]),
  locations: stringList.default([]),
  languages: stringList.default([]),
  priorityRank: z.number().int().min(1).max(1000).default(100),
  active: z.boolean().default(true),
});

const salespersonUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().max(320).optional(),
    active: z.boolean().optional(),
    unitSpecialties: stringList.optional(),
    locations: stringList.optional(),
    languages: stringList.optional(),
    priorityRank: z.number().int().min(1).max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no_fields_to_update' });

const projectCreateSchema = z.object({
  projectName: z.string().min(1).max(200),
  active: z.boolean().default(true),
  startingPrice: z.number().nonnegative().nullable().default(null),
  maxPrice: z.number().nonnegative().nullable().default(null),
  unitTypes: stringList.default([]),
  location: z.string().max(200).default(''),
  mapsUrl: z.string().max(2000).default(''),
});

const projectUpdateSchema = z
  .object({
    projectName: z.string().min(1).max(200).optional(),
    active: z.boolean().optional(),
    startingPrice: z.number().nonnegative().nullable().optional(),
    maxPrice: z.number().nonnegative().nullable().optional(),
    unitTypes: stringList.optional(),
    location: z.string().max(200).optional(),
    mapsUrl: z.string().max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no_fields_to_update' });

export async function dashboardDirectoryRoutes(
  app: FastifyInstance,
  deps: { directory: DashboardDirectoryService },
): Promise<void> {
  app.get('/api/salespeople', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const query = parseOrThrow(includeInactiveSchema, request.query);
    const salespeople = await deps.directory.listSalespeople(user.clientId, query.include_inactive === true);
    return { ok: true, salespeople };
  });

  app.post('/api/salespeople', async (request: FastifyRequest) => {
    const user = requireRole(request, MANAGERS);
    const body = parseOrThrow(salespersonCreateSchema, request.body);
    const salesperson = await deps.directory.createSalesperson(user, body);
    return { ok: true, salesperson };
  });

  app.patch('/api/salespeople/:id', async (request: FastifyRequest) => {
    const user = requireRole(request, MANAGERS);
    const params = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(salespersonUpdateSchema, request.body);
    const salesperson = await deps.directory.updateSalesperson(user, params.id, body);
    return { ok: true, salesperson };
  });

  app.get('/api/projects', async (request: FastifyRequest) => {
    const user = requireUser(request);
    const query = parseOrThrow(includeInactiveSchema, request.query);
    const projects = await deps.directory.listProjects(user.clientId, query.include_inactive === true);
    return { ok: true, projects };
  });

  app.post('/api/projects', async (request: FastifyRequest) => {
    const user = requireRole(request, MANAGERS);
    const body = parseOrThrow(projectCreateSchema, request.body);
    const project = await deps.directory.createProject(user, body);
    return { ok: true, project };
  });

  app.patch('/api/projects/:id', async (request: FastifyRequest) => {
    const user = requireRole(request, MANAGERS);
    const params = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(projectUpdateSchema, request.body);
    const project = await deps.directory.updateProject(user, params.id, body);
    return { ok: true, project };
  });
}
