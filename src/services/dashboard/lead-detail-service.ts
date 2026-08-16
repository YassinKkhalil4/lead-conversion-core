import { pool } from '../../db/pool.js';
import type { CompiledConfig } from '../../domain/types.js';
import { DashboardLeadListService, type LeadListItem } from './lead-list-service.js';
import { leadVisibilitySql, QueryParams } from './sql.js';
import { type DashboardScope, notFound } from './types.js';

/**
 * Used only when neither the session's pinned configuration version nor the
 * default active version can be read, so the detail screen still renders the
 * nine questions in their real order instead of alphabetically.
 */
const FALLBACK_QUESTION_ORDER = [
  'q_permission',
  'q_location',
  'q_unit_type',
  'q_budget',
  'q_payment_plan',
  'q_down_payment',
  'q_timeline',
  'q_purpose',
  'q_site_visit',
];

export interface QualificationAnswerView {
  questionKey: string;
  order: number;
  answered: boolean;
  normalizedValue: string;
  rawValue: string;
  parserSource: string;
  answeredAt: string | null;
}

export interface ScoreFactor {
  key: string;
  value: unknown;
  points: number;
  reason: string;
}

export interface ScoreRunView {
  scoreRunId: string;
  scoringVersion: string;
  score: number;
  temperature: string;
  factors: ScoreFactor[];
  missingAnswers: string[];
  createdAt: string;
}

export interface RoutingCandidateView {
  salespersonId: string;
  name: string;
  rank: number;
  score: number;
  phoneE164: string;
  unitMatch: boolean;
  languageMatch: boolean;
  locationMatch: boolean;
  priorityRank: number;
  activeAssignmentCount: number;
  selected: boolean;
}

export interface RoutingRunView {
  routingRunId: string;
  routingVersion: string;
  outcome: string;
  selectedSalespersonId: string | null;
  candidates: RoutingCandidateView[];
  reasons: Record<string, unknown>;
  createdAt: string;
}

export interface MessageView {
  messageId: string;
  direction: string;
  channel: string;
  messageText: string;
  messageType: string;
  state: string;
  fromAddress: string;
  providerMessageId: string;
  createdAt: string;
}

export interface AssignmentView {
  leadAssignmentId: string;
  salespersonId: string;
  salespersonName: string;
  salespersonPhoneE164: string;
  status: string;
  routingVersion: string;
  assignedAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
}

export interface ActivityView {
  auditEventId: string;
  eventType: string;
  actorType: string;
  actorId: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface LeadDetail {
  lead: LeadListItem;
  qualification: {
    qualificationSessionId: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    answers: QualificationAnswerView[];
  };
  latestScoreRun: ScoreRunView | null;
  latestRoutingRun: RoutingRunView | null;
  assignments: AssignmentView[];
  messages: MessageView[];
  activity: ActivityView[];
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseScoreFactors(factorsJson: unknown): { factors: ScoreFactor[]; missingAnswers: string[] } {
  const record = asRecord(factorsJson);
  const rawFactors = Array.isArray(record.factors) ? record.factors : Array.isArray(factorsJson) ? factorsJson : [];
  const factors = rawFactors.map((entry) => {
    const item = asRecord(entry);
    return {
      key: String(item.key ?? ''),
      value: item.value ?? null,
      points: toNumber(item.points),
      reason: String(item.reason ?? ''),
    };
  });
  const missing = Array.isArray(record.missingAnswers) ? record.missingAnswers : [];
  return { factors, missingAnswers: missing.map((entry) => String(entry)) };
}

export function parseRoutingCandidates(candidatesJson: unknown, selectedId: string | null): RoutingCandidateView[] {
  const entries = Array.isArray(candidatesJson) ? candidatesJson : [];
  return entries
    .map((entry) => {
      const item = asRecord(entry);
      const salespersonId = String(item.salespersonId ?? '');
      return {
        salespersonId,
        name: String(item.name ?? ''),
        rank: toNumber(item.rank),
        score: toNumber(item.score),
        phoneE164: String(item.phoneE164 ?? ''),
        unitMatch: Boolean(item.unitMatch),
        languageMatch: Boolean(item.languageMatch),
        locationMatch: Boolean(item.locationMatch),
        priorityRank: toNumber(item.priorityRank),
        activeAssignmentCount: toNumber(item.activeAssignmentCount),
        selected: Boolean(salespersonId) && salespersonId === selectedId,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export class DashboardLeadDetailService {
  constructor(private readonly leads = new DashboardLeadListService()) {}

  async detail(scope: DashboardScope, leadId: string, messageLimit = 200): Promise<LeadDetail> {
    const lead = await this.leads.findVisibleLead(scope, leadId);
    if (!lead) throw notFound('lead_not_found');

    const [qualification, scoreRun, routingRun, assignments, messages, activity] = await Promise.all([
      this.qualification(leadId),
      this.latestScoreRun(leadId),
      this.latestRoutingRun(leadId),
      this.assignments(leadId),
      this.messagePage(scope, leadId, messageLimit, 0),
      this.activity(scope, leadId, 50),
    ]);

    return {
      lead,
      qualification,
      latestScoreRun: scoreRun,
      latestRoutingRun: routingRun,
      assignments,
      messages: messages.messages,
      activity,
    };
  }

  async messages(
    scope: DashboardScope,
    leadId: string,
    limit: number,
    offset: number,
  ): Promise<{ messages: MessageView[]; total: number; limit: number; offset: number }> {
    // An invisible lead must be indistinguishable from a missing one, so this
    // answers 404 rather than an empty thread.
    const visible = await this.leads.findVisibleLead(scope, leadId);
    if (!visible) throw notFound('lead_not_found');
    return this.messagePage(scope, leadId, limit, offset);
  }

  private async messagePage(
    scope: DashboardScope,
    leadId: string,
    limit: number,
    offset: number,
  ): Promise<{ messages: MessageView[]; total: number; limit: number; offset: number }> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const leadParam = params.bind(leadId);
    const limitParam = params.bind(limit);
    const offsetParam = params.bind(offset);
    const result = await pool.query<{
      message_id: string;
      direction: string;
      channel: string;
      message_text: string;
      message_type: string;
      state: string;
      from_address: string;
      provider_message_id: string;
      created_at: Date;
      total_count: string;
    }>(
      `SELECT m.message_id, m.direction, m.channel, m.message_text, m.message_type,
              m.state, m.from_address, m.provider_message_id, m.created_at,
              count(*) OVER () AS total_count
       FROM app.messages m
       JOIN app.leads l ON l.lead_id = m.lead_id
       WHERE (${visibility}) AND m.lead_id = ${leadParam}::uuid
       ORDER BY m.created_at ASC, m.message_id ASC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params.list(),
    );
    return {
      messages: result.rows.map((row) => ({
        messageId: row.message_id,
        direction: row.direction,
        channel: row.channel,
        messageText: row.message_text,
        messageType: row.message_type,
        state: row.state,
        fromAddress: row.from_address,
        providerMessageId: row.provider_message_id,
        createdAt: row.created_at.toISOString(),
      })),
      total: Number(result.rows[0]?.total_count ?? 0),
      limit,
      offset,
    };
  }

  private async qualification(leadId: string): Promise<LeadDetail['qualification']> {
    const session = await pool.query<{
      qualification_session_id: string;
      status: string;
      started_at: Date;
      completed_at: Date | null;
      configuration_version_id: string | null;
    }>(
      `SELECT qualification_session_id, status, started_at, completed_at, configuration_version_id
       FROM app.qualification_sessions
       WHERE lead_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [leadId],
    );
    const row = session.rows[0];
    const order = await this.questionOrder(row?.configuration_version_id ?? null);
    if (!row) {
      return {
        qualificationSessionId: null,
        status: 'not_started',
        startedAt: null,
        completedAt: null,
        answers: order.map((questionKey, index) => ({
          questionKey,
          order: index + 1,
          answered: false,
          normalizedValue: '',
          rawValue: '',
          parserSource: '',
          answeredAt: null,
        })),
      };
    }

    const answers = await pool.query<{
      question_key: string;
      normalized_value: string;
      raw_value: string;
      parser_source: string;
      answered_at: Date;
    }>(
      `SELECT question_key, normalized_value, raw_value, parser_source, answered_at
       FROM app.qualification_answers
       WHERE qualification_session_id = $1`,
      [row.qualification_session_id],
    );
    const byKey = new Map(answers.rows.map((answer) => [answer.question_key, answer]));
    // Anything answered but absent from the configuration still has to appear,
    // otherwise a configuration change would silently hide real answers.
    const keys = [...order, ...answers.rows.map((answer) => answer.question_key).filter((key) => !order.includes(key))];

    return {
      qualificationSessionId: row.qualification_session_id,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      completedAt: iso(row.completed_at),
      answers: keys.map((questionKey, index) => {
        const answer = byKey.get(questionKey);
        return {
          questionKey,
          order: index + 1,
          answered: Boolean(answer),
          normalizedValue: answer?.normalized_value ?? '',
          rawValue: answer?.raw_value ?? '',
          parserSource: answer?.parser_source ?? '',
          answeredAt: answer ? answer.answered_at.toISOString() : null,
        };
      }),
    };
  }

  private async questionOrder(configurationVersionId: string | null): Promise<string[]> {
    const sql = configurationVersionId
      ? `SELECT config_json FROM configuration.versions WHERE configuration_version_id = $1`
      : `SELECT v.config_json
         FROM configuration.active_versions a
         JOIN configuration.versions v USING (configuration_version_id)
         WHERE a.scope_key = 'default'
         LIMIT 1`;
    const result = await pool.query<{ config_json: CompiledConfig }>(
      sql,
      configurationVersionId ? [configurationVersionId] : [],
    );
    const questions = result.rows[0]?.config_json?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return [...FALLBACK_QUESTION_ORDER];
    return [...questions]
      .sort((a, b) => a.order - b.order)
      .map((question) => question.questionKey);
  }

  private async latestScoreRun(leadId: string): Promise<ScoreRunView | null> {
    const result = await pool.query<{
      score_run_id: string;
      scoring_version: string;
      score: number;
      temperature: string;
      factors_json: unknown;
      created_at: Date;
    }>(
      `SELECT score_run_id, scoring_version, score, temperature, factors_json, created_at
       FROM app.score_runs
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [leadId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const parsed = parseScoreFactors(row.factors_json);
    return {
      scoreRunId: row.score_run_id,
      scoringVersion: row.scoring_version,
      score: Number(row.score),
      temperature: row.temperature,
      factors: parsed.factors,
      missingAnswers: parsed.missingAnswers,
      createdAt: row.created_at.toISOString(),
    };
  }

  private async latestRoutingRun(leadId: string): Promise<RoutingRunView | null> {
    const result = await pool.query<{
      routing_run_id: string;
      routing_version: string;
      outcome: string;
      selected_salesperson_id: string | null;
      candidates_json: unknown;
      reasons_json: unknown;
      created_at: Date;
    }>(
      `SELECT routing_run_id, routing_version, outcome, selected_salesperson_id,
              candidates_json, reasons_json, created_at
       FROM app.routing_runs
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [leadId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      routingRunId: row.routing_run_id,
      routingVersion: row.routing_version,
      outcome: row.outcome,
      selectedSalespersonId: row.selected_salesperson_id,
      candidates: parseRoutingCandidates(row.candidates_json, row.selected_salesperson_id),
      reasons: asRecord(row.reasons_json),
      createdAt: row.created_at.toISOString(),
    };
  }

  private async assignments(leadId: string): Promise<AssignmentView[]> {
    const result = await pool.query<{
      lead_assignment_id: string;
      salesperson_id: string;
      name: string | null;
      phone_e164: string | null;
      status: string;
      routing_version: string;
      assigned_at: Date;
      acknowledged_at: Date | null;
      closed_at: Date | null;
    }>(
      `SELECT a.lead_assignment_id, a.salesperson_id, sp.name, sp.phone_e164,
              a.status, a.routing_version, a.assigned_at, a.acknowledged_at, a.closed_at
       FROM app.lead_assignments a
       LEFT JOIN app.salespeople sp ON sp.salesperson_id = a.salesperson_id
       WHERE a.lead_id = $1
       ORDER BY a.assigned_at DESC`,
      [leadId],
    );
    return result.rows.map((row) => ({
      leadAssignmentId: row.lead_assignment_id,
      salespersonId: row.salesperson_id,
      salespersonName: row.name || '',
      salespersonPhoneE164: row.phone_e164 || '',
      status: row.status,
      routingVersion: row.routing_version,
      assignedAt: row.assigned_at.toISOString(),
      acknowledgedAt: iso(row.acknowledged_at),
      closedAt: iso(row.closed_at),
    }));
  }

  private async activity(scope: DashboardScope, leadId: string, limit: number): Promise<ActivityView[]> {
    const result = await pool.query<{
      audit_event_id: string;
      event_type: string;
      actor_type: string;
      actor_id: string;
      aggregate_type: string;
      aggregate_id: string | null;
      payload_json: unknown;
      created_at: Date;
    }>(
      `SELECT e.audit_event_id, e.event_type, e.actor_type, e.actor_id,
              e.aggregate_type, e.aggregate_id, e.payload_json, e.created_at
       FROM audit.events e
       WHERE e.aggregate_id = $1::uuid
         AND EXISTS (SELECT 1 FROM app.leads l WHERE l.lead_id = $1::uuid AND l.client_id = $2::uuid)
       ORDER BY e.created_at DESC
       LIMIT $3`,
      [leadId, scope.clientId, limit],
    );
    return result.rows.map((row) => ({
      auditEventId: row.audit_event_id,
      eventType: row.event_type,
      actorType: row.actor_type,
      actorId: row.actor_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: asRecord(row.payload_json),
      createdAt: row.created_at.toISOString(),
    }));
  }
}
