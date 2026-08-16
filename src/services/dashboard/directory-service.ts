import { pool } from '../../db/pool.js';
import { AuditRepository } from '../../infrastructure/runtime.js';
import { conflict, type DashboardUser, notFound } from './types.js';

export interface SalespersonView {
  salespersonId: string;
  name: string;
  phoneE164: string;
  email: string;
  active: boolean;
  unitSpecialties: string[];
  locations: string[];
  languages: string[];
  priorityRank: number;
  activeAssignmentCount: number;
  unacknowledgedAssignmentCount: number;
  createdAt: string;
}

export interface ProjectView {
  projectId: string;
  projectName: string;
  active: boolean;
  startingPrice: number | null;
  maxPrice: number | null;
  unitTypes: string[];
  location: string;
  mapsUrl: string;
  createdAt: string;
}

interface SalespersonRow {
  salesperson_id: string;
  name: string;
  phone_e164: string;
  email: string;
  active: boolean;
  unit_specialties: string[];
  locations: string[];
  languages: string[];
  priority_rank: number;
  active_assignment_count: string;
  unacknowledged_assignment_count: string;
  created_at: Date;
}

interface ProjectRow {
  project_id: string;
  project_name: string;
  active: boolean;
  starting_price: string | null;
  max_price: string | null;
  unit_types: string[];
  location: string;
  maps_url: string;
  created_at: Date;
}

function toSalesperson(row: SalespersonRow): SalespersonView {
  return {
    salespersonId: row.salesperson_id,
    name: row.name,
    phoneE164: row.phone_e164,
    email: row.email,
    active: row.active,
    unitSpecialties: row.unit_specialties ?? [],
    locations: row.locations ?? [],
    languages: row.languages ?? [],
    priorityRank: row.priority_rank,
    activeAssignmentCount: Number(row.active_assignment_count),
    unacknowledgedAssignmentCount: Number(row.unacknowledged_assignment_count),
    createdAt: row.created_at.toISOString(),
  };
}

function toProject(row: ProjectRow): ProjectView {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    active: row.active,
    startingPrice: row.starting_price === null ? null : Number(row.starting_price),
    maxPrice: row.max_price === null ? null : Number(row.max_price),
    unitTypes: row.unit_types ?? [],
    location: row.location,
    mapsUrl: row.maps_url,
    createdAt: row.created_at.toISOString(),
  };
}

const SALESPERSON_COLUMNS = `
  sp.salesperson_id, sp.name, sp.phone_e164, sp.email, sp.active,
  sp.unit_specialties, sp.locations, sp.languages, sp.priority_rank, sp.created_at,
  (SELECT count(*) FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id AND a.status = 'assigned') AS active_assignment_count,
  (SELECT count(*) FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id AND a.status = 'assigned'
      AND a.acknowledged_at IS NULL) AS unacknowledged_assignment_count
`;

const PROJECT_COLUMNS = `
  p.project_id, p.project_name, p.active, p.starting_price, p.max_price,
  p.unit_types, p.location, p.maps_url, p.created_at
`;

export class DashboardDirectoryService {
  constructor(private readonly audit = new AuditRepository()) {}

  async listSalespeople(clientId: string, includeInactive: boolean): Promise<SalespersonView[]> {
    const result = await pool.query<SalespersonRow>(
      `SELECT ${SALESPERSON_COLUMNS}
       FROM app.salespeople sp
       WHERE sp.client_id = $1 AND ($2 OR sp.active)
       ORDER BY sp.active DESC, sp.priority_rank ASC, sp.name ASC`,
      [clientId, includeInactive],
    );
    return result.rows.map(toSalesperson);
  }

  async createSalesperson(
    actor: DashboardUser,
    input: {
      name: string;
      phoneE164: string;
      email: string;
      unitSpecialties: string[];
      locations: string[];
      languages: string[];
      priorityRank: number;
      active: boolean;
    },
  ): Promise<SalespersonView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ salesperson_id: string }>(
        `INSERT INTO app.salespeople
          (client_id, name, phone_e164, email, active, unit_specialties, locations, languages, priority_rank)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::text[], $9)
         ON CONFLICT (client_id, phone_e164) DO NOTHING
         RETURNING salesperson_id`,
        [
          actor.clientId,
          input.name,
          input.phoneE164,
          input.email,
          input.active,
          input.unitSpecialties,
          input.locations,
          input.languages,
          input.priorityRank,
        ],
      );
      const salespersonId = inserted.rows[0]?.salesperson_id;
      if (!salespersonId) throw conflict('salesperson_phone_already_exists', { phoneE164: input.phoneE164 });
      await this.audit.record(client, {
        eventType: 'dashboard.salesperson_created',
        actorType: 'operator',
        actorId: actor.userId,
        aggregateType: 'salesperson',
        aggregateId: salespersonId,
        payload: { clientId: actor.clientId, priorityRank: input.priorityRank },
      });
      await client.query('COMMIT');
      const view = await this.findSalesperson(actor.clientId, salespersonId);
      if (!view) throw new Error('salesperson_not_readable_after_create');
      return view;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateSalesperson(
    actor: DashboardUser,
    salespersonId: string,
    input: {
      name?: string | undefined;
      email?: string | undefined;
      active?: boolean | undefined;
      unitSpecialties?: string[] | undefined;
      locations?: string[] | undefined;
      languages?: string[] | undefined;
      priorityRank?: number | undefined;
    },
  ): Promise<SalespersonView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ salesperson_id: string }>(
        `UPDATE app.salespeople
         SET name = COALESCE($3, name),
             email = COALESCE($4, email),
             active = COALESCE($5, active),
             unit_specialties = COALESCE($6::text[], unit_specialties),
             locations = COALESCE($7::text[], locations),
             languages = COALESCE($8::text[], languages),
             priority_rank = COALESCE($9, priority_rank),
             updated_at = now()
         WHERE salesperson_id = $1 AND client_id = $2
         RETURNING salesperson_id`,
        [
          salespersonId,
          actor.clientId,
          input.name ?? null,
          input.email ?? null,
          input.active ?? null,
          input.unitSpecialties ?? null,
          input.locations ?? null,
          input.languages ?? null,
          input.priorityRank ?? null,
        ],
      );
      if (!updated.rows[0]) throw notFound('salesperson_not_found');
      await this.audit.record(client, {
        eventType: 'dashboard.salesperson_updated',
        actorType: 'operator',
        actorId: actor.userId,
        aggregateType: 'salesperson',
        aggregateId: salespersonId,
        payload: { clientId: actor.clientId, fields: Object.keys(input) },
      });
      await client.query('COMMIT');
      const view = await this.findSalesperson(actor.clientId, salespersonId);
      if (!view) throw notFound('salesperson_not_found');
      return view;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listProjects(clientId: string, includeInactive: boolean): Promise<ProjectView[]> {
    const result = await pool.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}
       FROM app.projects p
       WHERE p.client_id = $1 AND ($2 OR p.active)
       ORDER BY p.active DESC, p.project_name ASC`,
      [clientId, includeInactive],
    );
    return result.rows.map(toProject);
  }

  async createProject(
    actor: DashboardUser,
    input: {
      projectName: string;
      active: boolean;
      startingPrice: number | null;
      maxPrice: number | null;
      unitTypes: string[];
      location: string;
      mapsUrl: string;
    },
  ): Promise<ProjectView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<ProjectRow>(
        `INSERT INTO app.projects
          (client_id, project_name, active, starting_price, max_price, unit_types, location, maps_url)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8)
         RETURNING project_id, project_name, active, starting_price, max_price,
                   unit_types, location, maps_url, created_at`,
        [
          actor.clientId,
          input.projectName,
          input.active,
          input.startingPrice,
          input.maxPrice,
          input.unitTypes,
          input.location,
          input.mapsUrl,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('project_not_created');
      await this.audit.record(client, {
        eventType: 'dashboard.project_created',
        actorType: 'operator',
        actorId: actor.userId,
        aggregateType: 'project',
        aggregateId: row.project_id,
        payload: { clientId: actor.clientId, projectName: input.projectName },
      });
      await client.query('COMMIT');
      return toProject(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateProject(
    actor: DashboardUser,
    projectId: string,
    input: {
      projectName?: string | undefined;
      active?: boolean | undefined;
      startingPrice?: number | null | undefined;
      maxPrice?: number | null | undefined;
      unitTypes?: string[] | undefined;
      location?: string | undefined;
      mapsUrl?: string | undefined;
    },
  ): Promise<ProjectView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<ProjectRow>(
        `UPDATE app.projects
         SET project_name = COALESCE($3, project_name),
             active = COALESCE($4, active),
             starting_price = CASE WHEN $5::boolean THEN $6::numeric ELSE starting_price END,
             max_price = CASE WHEN $7::boolean THEN $8::numeric ELSE max_price END,
             unit_types = COALESCE($9::text[], unit_types),
             location = COALESCE($10, location),
             maps_url = COALESCE($11, maps_url),
             updated_at = now()
         WHERE project_id = $1 AND client_id = $2
         RETURNING project_id, project_name, active, starting_price, max_price,
                   unit_types, location, maps_url, created_at`,
        [
          projectId,
          actor.clientId,
          input.projectName ?? null,
          input.active ?? null,
          input.startingPrice !== undefined,
          input.startingPrice ?? null,
          input.maxPrice !== undefined,
          input.maxPrice ?? null,
          input.unitTypes ?? null,
          input.location ?? null,
          input.mapsUrl ?? null,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw notFound('project_not_found');
      await this.audit.record(client, {
        eventType: 'dashboard.project_updated',
        actorType: 'operator',
        actorId: actor.userId,
        aggregateType: 'project',
        aggregateId: projectId,
        payload: { clientId: actor.clientId, fields: Object.keys(input) },
      });
      await client.query('COMMIT');
      return toProject(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findSalesperson(clientId: string, salespersonId: string): Promise<SalespersonView | null> {
    const result = await pool.query<SalespersonRow>(
      `SELECT ${SALESPERSON_COLUMNS}
       FROM app.salespeople sp
       WHERE sp.client_id = $1 AND sp.salesperson_id = $2`,
      [clientId, salespersonId],
    );
    const row = result.rows[0];
    return row ? toSalesperson(row) : null;
  }
}
