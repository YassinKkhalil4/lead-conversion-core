import { pool } from '../../db/pool.js';
import { leadVisibilitySql, QueryParams } from './sql.js';
import type { DashboardScope } from './types.js';

export const LEAD_SORT_COLUMNS: Record<string, string> = {
  created_at: 'l.created_at',
  lead_score: 'l.lead_score',
  last_message_at: 'COALESCE(msg.last_message_at, l.last_message_at)',
};

export interface LeadListFilters {
  status?: string[];
  temperature?: string[];
  assignedTo?: string;
  source?: string[];
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  unacknowledgedOnly?: boolean;
  sort: string;
  direction: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface LeadListItem {
  leadId: string;
  clientId: string;
  status: string;
  currentStage: string;
  temperature: string;
  leadScore: number | null;
  source: string;
  provider: string;
  stopFollowUp: boolean;
  closedStatus: string;
  firstReceivedAt: string | null;
  firstContactedAt: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  sessionWindowExpiresAt: string | null;
  sessionWindowOpen: boolean;
  humanTakeover: boolean;
  messageCount: number;
  createdAt: string;
  contact: { contactId: string; name: string; phoneE164: string; email: string };
  project: { projectId: string; projectName: string; location: string } | null;
  assignment: {
    leadAssignmentId: string;
    salespersonId: string;
    salespersonName: string;
    salespersonPhoneE164: string;
    status: string;
    assignedAt: string;
    acknowledgedAt: string | null;
  } | null;
  latestScore: { scoreRunId: string; score: number; temperature: string; scoringVersion: string; createdAt: string } | null;
}

export interface LeadListPage {
  leads: LeadListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface LeadRow {
  lead_id: string;
  client_id: string;
  status: string;
  current_stage: string;
  temperature: string;
  lead_score: number | null;
  source: string;
  provider: string;
  stop_follow_up: boolean;
  closed_status: string;
  first_received_at: Date | null;
  first_contacted_at: Date | null;
  created_at: Date;
  last_message_at: Date | null;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  session_window_expires_at: Date | null;
  session_window_open: boolean;
  human_takeover: boolean;
  message_count: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  project_id: string | null;
  project_name: string | null;
  project_location: string | null;
  lead_assignment_id: string | null;
  assignment_salesperson_id: string | null;
  assignment_status: string | null;
  assigned_at: Date | null;
  acknowledged_at: Date | null;
  salesperson_name: string | null;
  salesperson_phone: string | null;
  score_run_id: string | null;
  score: number | null;
  score_temperature: string | null;
  scoring_version: string | null;
  scored_at: Date | null;
  total_count: string;
}

/**
 * `app.leads.last_message_at` is a projection column the conversation engine
 * never writes, so recency is derived from `app.messages`, which is the
 * authoritative log. The same lateral yields the 24-hour session window used by
 * the reply composer.
 */
const LEAD_FROM = `
  FROM app.leads l
  JOIN app.contacts ct ON ct.contact_id = l.contact_id
  LEFT JOIN app.projects p ON p.project_id = l.project_id
  LEFT JOIN LATERAL (
    SELECT
      max(m.created_at) AS last_message_at,
      max(m.created_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at,
      max(m.created_at) FILTER (WHERE m.direction = 'outbound') AS last_outbound_at,
      count(*) AS message_count
    FROM app.messages m
    WHERE m.lead_id = l.lead_id
  ) msg ON true
  LEFT JOIN LATERAL (
    SELECT conv.human_takeover, conv.last_inbound_at, conv.conversation_window_expires_at
    FROM app.conversations conv
    WHERE conv.lead_id = l.lead_id
    ORDER BY conv.opened_at DESC
    LIMIT 1
  ) conv ON true
  LEFT JOIN LATERAL (
    SELECT a.lead_assignment_id, a.salesperson_id, a.status, a.assigned_at, a.acknowledged_at
    FROM app.lead_assignments a
    WHERE a.lead_id = l.lead_id
    ORDER BY (a.status = 'assigned') DESC, a.assigned_at DESC
    LIMIT 1
  ) la ON true
  LEFT JOIN app.salespeople sp ON sp.salesperson_id = la.salesperson_id
  LEFT JOIN LATERAL (
    SELECT s.score_run_id, s.score, s.temperature, s.scoring_version, s.created_at
    FROM app.score_runs s
    WHERE s.lead_id = l.lead_id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) sr ON true
`;

export const LEAD_SELECT_COLUMNS = `
  l.lead_id, l.client_id, l.status, l.current_stage, l.temperature, l.lead_score,
  l.source, l.provider, l.stop_follow_up, l.closed_status,
  l.first_received_at, l.first_contacted_at, l.created_at,
  COALESCE(msg.last_message_at, l.last_message_at) AS last_message_at,
  COALESCE(msg.last_inbound_at, conv.last_inbound_at) AS last_inbound_at,
  COALESCE(msg.last_outbound_at, l.last_outbound_at) AS last_outbound_at,
  COALESCE(
    conv.conversation_window_expires_at,
    COALESCE(msg.last_inbound_at, conv.last_inbound_at) + interval '24 hours'
  ) AS session_window_expires_at,
  COALESCE(
    conv.conversation_window_expires_at,
    COALESCE(msg.last_inbound_at, conv.last_inbound_at) + interval '24 hours'
  ) > now() AS session_window_open,
  COALESCE(conv.human_takeover, false) AS human_takeover,
  COALESCE(msg.message_count, 0) AS message_count,
  ct.contact_id, ct.name AS contact_name, ct.phone_e164 AS contact_phone, ct.email AS contact_email,
  p.project_id, p.project_name, p.location AS project_location,
  la.lead_assignment_id, la.salesperson_id AS assignment_salesperson_id,
  la.status AS assignment_status, la.assigned_at, la.acknowledged_at,
  sp.name AS salesperson_name, sp.phone_e164 AS salesperson_phone,
  sr.score_run_id, sr.score, sr.temperature AS score_temperature,
  sr.scoring_version, sr.created_at AS scored_at
`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toLeadListItem(row: LeadRow): LeadListItem {
  return {
    leadId: row.lead_id,
    clientId: row.client_id,
    status: row.status,
    currentStage: row.current_stage,
    temperature: row.temperature,
    leadScore: row.lead_score,
    source: row.source,
    provider: row.provider,
    stopFollowUp: row.stop_follow_up,
    closedStatus: row.closed_status,
    firstReceivedAt: iso(row.first_received_at),
    firstContactedAt: iso(row.first_contacted_at),
    lastMessageAt: iso(row.last_message_at),
    lastInboundAt: iso(row.last_inbound_at),
    lastOutboundAt: iso(row.last_outbound_at),
    sessionWindowExpiresAt: iso(row.session_window_expires_at),
    sessionWindowOpen: Boolean(row.session_window_open),
    humanTakeover: row.human_takeover,
    messageCount: Number(row.message_count),
    createdAt: row.created_at.toISOString(),
    contact: {
      contactId: row.contact_id,
      name: row.contact_name,
      phoneE164: row.contact_phone,
      email: row.contact_email,
    },
    project: row.project_id
      ? {
          projectId: row.project_id,
          projectName: row.project_name || '',
          location: row.project_location || '',
        }
      : null,
    assignment: row.lead_assignment_id
      ? {
          leadAssignmentId: row.lead_assignment_id,
          salespersonId: row.assignment_salesperson_id || '',
          salespersonName: row.salesperson_name || '',
          salespersonPhoneE164: row.salesperson_phone || '',
          status: row.assignment_status || '',
          assignedAt: iso(row.assigned_at) || '',
          acknowledgedAt: iso(row.acknowledged_at),
        }
      : null,
    latestScore: row.score_run_id
      ? {
          scoreRunId: row.score_run_id,
          score: Number(row.score),
          temperature: row.score_temperature || '',
          scoringVersion: row.scoring_version || '',
          createdAt: iso(row.scored_at) || '',
        }
      : null,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export class DashboardLeadListService {
  async list(scope: DashboardScope, filters: LeadListFilters): Promise<LeadListPage> {
    const params = new QueryParams();
    const conditions = [leadVisibilitySql('l', scope, params)];

    if (filters.status?.length) {
      conditions.push(`l.status = ANY(${params.bind(filters.status)}::text[])`);
    }
    if (filters.temperature?.length) {
      conditions.push(`l.temperature = ANY(${params.bind(filters.temperature)}::text[])`);
    }
    if (filters.source?.length) {
      conditions.push(`l.source = ANY(${params.bind(filters.source)}::text[])`);
    }
    if (filters.createdFrom) {
      conditions.push(`l.created_at >= ${params.bind(filters.createdFrom)}::timestamptz`);
    }
    if (filters.createdTo) {
      conditions.push(`l.created_at <= ${params.bind(filters.createdTo)}::timestamptz`);
    }
    if (filters.assignedTo === 'unassigned') {
      conditions.push(`la.lead_assignment_id IS NULL OR la.status <> 'assigned'`);
    } else if (filters.assignedTo) {
      conditions.push(
        `la.salesperson_id = ${params.bind(filters.assignedTo)}::uuid AND la.status = 'assigned'`,
      );
    }
    if (filters.unacknowledgedOnly) {
      conditions.push(`la.status = 'assigned' AND la.acknowledged_at IS NULL`);
    }
    if (filters.search) {
      const pattern = params.bind(`%${escapeLike(filters.search.trim())}%`);
      conditions.push(`(ct.name ILIKE ${pattern} ESCAPE '\\' OR ct.phone_e164 ILIKE ${pattern} ESCAPE '\\')`);
    }

    const sortColumn = LEAD_SORT_COLUMNS[filters.sort] ?? 'l.created_at';
    const sortDirection = filters.direction === 'asc' ? 'ASC' : 'DESC';
    const limit = params.bind(filters.limit);
    const offset = params.bind(filters.offset);

    const result = await pool.query<LeadRow>(
      `SELECT ${LEAD_SELECT_COLUMNS}, count(*) OVER () AS total_count
       ${LEAD_FROM}
       WHERE ${conditions.map((condition) => `(${condition})`).join(' AND ')}
       ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, l.lead_id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params.list(),
    );

    return {
      leads: result.rows.map(toLeadListItem),
      total: Number(result.rows[0]?.total_count ?? 0),
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async findVisibleLead(scope: DashboardScope, leadId: string): Promise<LeadListItem | null> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const leadParam = params.bind(leadId);
    const result = await pool.query<LeadRow>(
      `SELECT ${LEAD_SELECT_COLUMNS}, 1 AS total_count
       ${LEAD_FROM}
       WHERE (${visibility}) AND l.lead_id = ${leadParam}::uuid`,
      params.list(),
    );
    const row = result.rows[0];
    return row ? toLeadListItem(row) : null;
  }
}
