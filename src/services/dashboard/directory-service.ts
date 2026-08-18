import { pool } from '../../db/pool.js';
import { AuditRepository } from '../../infrastructure/runtime.js';
import { badRequest, conflict, type DashboardUser, notFound } from './types.js';

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
  /** Active assignments this salesperson may hold before routing skips them. */
  capacityLimit: number;
  activeAssignmentCount: number;
  unacknowledgedAssignmentCount: number;
  /** Assignments unacknowledged past the 15-minute SLA reminder, right now. */
  overdueAssignmentCount: number;
  /** Assignments this salesperson has ever acknowledged. */
  acknowledgedCount: number;
  /** Mean assignment-to-acknowledgement time, null until they acknowledge one. */
  avgAcknowledgementSeconds: number | null;
  createdAt: string;
}

export interface ProjectView {
  projectId: string;
  /**
   * Salespeople eligible for this project. Routing matches on this join, so a
   * project with nobody assigned can never be routed to.
   */
  salespersonIds: string[];
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
  capacity_limit: number;
  active_assignment_count: string;
  unacknowledged_assignment_count: string;
  overdue_assignment_count: string;
  acknowledged_count: string;
  avg_acknowledgement_seconds: string | null;
  created_at: Date;
}

interface ProjectRow {
  project_id: string;
  salesperson_ids: string[] | null;
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
    capacityLimit: row.capacity_limit,
    activeAssignmentCount: Number(row.active_assignment_count),
    unacknowledgedAssignmentCount: Number(row.unacknowledged_assignment_count),
    overdueAssignmentCount: Number(row.overdue_assignment_count),
    acknowledgedCount: Number(row.acknowledged_count),
    avgAcknowledgementSeconds:
      row.avg_acknowledgement_seconds === null ? null : Math.round(Number(row.avg_acknowledgement_seconds)),
    createdAt: row.created_at.toISOString(),
  };
}

function toProject(row: ProjectRow): ProjectView {
  return {
    projectId: row.project_id,
    salespersonIds: row.salesperson_ids ?? [],
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
  sp.unit_specialties, sp.locations, sp.languages, sp.priority_rank, sp.capacity_limit, sp.created_at,
  (SELECT count(*) FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id AND a.status = 'assigned') AS active_assignment_count,
  (SELECT count(*) FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id AND a.status = 'assigned'
      AND a.acknowledged_at IS NULL) AS unacknowledged_assignment_count,
  (SELECT count(*) FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id AND a.status = 'assigned'
      AND a.acknowledged_at IS NULL
      AND a.assigned_at <= now() - interval '15 minutes') AS overdue_assignment_count,
  (SELECT count(*) FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id
      AND a.acknowledged_at IS NOT NULL) AS acknowledged_count,
  (SELECT avg(extract(epoch FROM (a.acknowledged_at - a.assigned_at)))
     FROM app.lead_assignments a
    WHERE a.salesperson_id = sp.salesperson_id
      AND a.acknowledged_at IS NOT NULL) AS avg_acknowledgement_seconds
`;

const PROJECT_COLUMNS = `
  p.project_id, p.project_name, p.active, p.starting_price, p.max_price,
  p.unit_types, p.location, p.maps_url, p.created_at,
  ARRAY(
    SELECT spp.salesperson_id::text
    FROM app.salesperson_projects spp
    JOIN app.salespeople s2 ON s2.salesperson_id = spp.salesperson_id
    WHERE spp.project_id = p.project_id AND s2.client_id = p.client_id
    ORDER BY s2.priority_rank, s2.name
  ) AS salesperson_ids
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
      capacityLimit: number;
      active: boolean;
    },
  ): Promise<SalespersonView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ salesperson_id: string }>(
        `INSERT INTO app.salespeople
          (client_id, name, phone_e164, email, active, unit_specialties, locations, languages,
           priority_rank, capacity_limit)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::text[], $9, $10)
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
          input.capacityLimit,
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
      capacityLimit?: number | undefined;
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
             capacity_limit = COALESCE($10, capacity_limit),
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
          input.capacityLimit ?? null,
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
                   unit_types, location, maps_url, created_at,
                   ARRAY[]::text[] AS salesperson_ids`,
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
                   unit_types, location, maps_url, created_at,
                   ARRAY[]::text[] AS salesperson_ids`,
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

  /**
   * Replaces the set of salespeople eligible for a project.
   *
   * Routing reads this join, so it is written as a whole set inside one
   * transaction rather than as add/remove calls: a half-applied change would
   * silently narrow who can receive a lead.
   */
  async setProjectSalespeople(
    actor: DashboardUser,
    projectId: string,
    salespersonIds: string[],
  ): Promise<ProjectView> {
    const unique = [...new Set(salespersonIds)];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const project = await client.query<{ project_id: string }>(
        'SELECT project_id FROM app.projects WHERE project_id = $1 AND client_id = $2 FOR UPDATE',
        [projectId, actor.clientId],
      );
      if (!project.rows[0]) throw notFound('project_not_found');

      // Every id must belong to the caller's client, so a crafted request
      // cannot attach another brokerage's salesperson to this project.
      if (unique.length > 0) {
        const owned = await client.query<{ salesperson_id: string }>(
          `SELECT salesperson_id FROM app.salespeople
           WHERE client_id = $1 AND salesperson_id = ANY($2::uuid[])`,
          [actor.clientId, unique],
        );
        if (owned.rows.length !== unique.length) throw badRequest('salesperson_not_in_client');
      }

      await client.query('DELETE FROM app.salesperson_projects WHERE project_id = $1', [projectId]);
      if (unique.length > 0) {
        await client.query(
          `INSERT INTO app.salesperson_projects (salesperson_id, project_id)
           SELECT unnest($1::uuid[]), $2`,
          [unique, projectId],
        );
      }
      await this.audit.record(client, {
        eventType: 'dashboard.project_salespeople_set',
        actorType: 'operator',
        actorId: actor.userId,
        aggregateType: 'project',
        aggregateId: projectId,
        payload: { clientId: actor.clientId, salespersonIds: unique, count: unique.length },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const view = await this.findProject(actor.clientId, projectId);
    if (!view) throw notFound('project_not_found');
    return view;
  }

  private async findProject(clientId: string, projectId: string): Promise<ProjectView | null> {
    const result = await pool.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}
       FROM app.projects p
       WHERE p.client_id = $1 AND p.project_id = $2`,
      [clientId, projectId],
    );
    const row = result.rows[0];
    return row ? toProject(row) : null;
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
