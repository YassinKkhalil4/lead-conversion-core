import { pool } from '../../db/pool.js';
import type { ActivityView } from './lead-detail-service.js';
import { leadVisibilitySql, QueryParams } from './sql.js';
import type { DashboardScope } from './types.js';

export interface PeriodMetrics {
  newLeads: number;
  qualifiedLeads: number;
  closedLeads: number;
  assignedUnacknowledged: number;
  /** Assignments acknowledged in the period, not leads created in it. */
  acknowledged: number;
  /** Distinct leads that received an outbound message in the period. */
  replied: number;
  conversionRate: number;
}

export interface ResponseTimeMetrics {
  /** Lead arrival to the automated first-contact message. */
  avgFirstContactSeconds: number | null;
  medianFirstContactSeconds: number | null;
  slowestFirstContactSeconds: number | null;
  /** Assignment to salesperson acknowledgement. */
  avgAcknowledgementSeconds: number | null;
  medianAcknowledgementSeconds: number | null;
  /** Assignments still unacknowledged right now, and the oldest of them. */
  pendingAcknowledgements: number;
  oldestPendingAcknowledgementSeconds: number | null;
}

export interface DashboardSummary {
  timezone: string;
  generatedAt: string;
  periods: { today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics };
  responseTime: ResponseTimeMetrics;
  leadsByTemperature: { temperature: string; count: number }[];
  leadsBySource: { source: string; count: number }[];
}

interface SummaryRow {
  acknowledged_today: string;
  acknowledged_week: string;
  acknowledged_month: string;
  replied_today: string;
  replied_week: string;
  replied_month: string;
  new_today: string;
  new_week: string;
  new_month: string;
  qualified_today: string;
  qualified_week: string;
  qualified_month: string;
  closed_today: string;
  closed_week: string;
  closed_month: string;
  unack_today: string;
  unack_week: string;
  unack_month: string;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function seconds(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export class DashboardSummaryService {
  async summary(scope: DashboardScope, timezone: string): Promise<DashboardSummary> {
    const [counts, responseTime, temperature, source] = await Promise.all([
      this.periodCounts(scope, timezone),
      this.responseTime(scope),
      this.leadsByTemperature(scope),
      this.leadsBySource(scope),
    ]);
    return {
      timezone,
      generatedAt: new Date().toISOString(),
      periods: counts,
      responseTime,
      leadsByTemperature: temperature,
      leadsBySource: source,
    };
  }

  private async periodCounts(
    scope: DashboardScope,
    timezone: string,
  ): Promise<DashboardSummary['periods']> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const tz = params.bind(timezone);
    const result = await pool.query<SummaryRow>(
      `WITH bounds AS (
         SELECT
           (date_trunc('day',   now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS day_start,
           (date_trunc('week',  now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS week_start,
           (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS month_start
       ),
       visible AS (
         SELECT l.lead_id, l.status, l.created_at
         FROM app.leads l
         WHERE ${visibility}
       ),
       assignments AS (
         SELECT a.assigned_at
         FROM app.lead_assignments a
         JOIN visible v ON v.lead_id = a.lead_id
         WHERE a.status = 'assigned' AND a.acknowledged_at IS NULL
       ),
       acknowledgements AS (
         SELECT a.acknowledged_at
         FROM app.lead_assignments a
         JOIN visible v ON v.lead_id = a.lead_id
         WHERE a.acknowledged_at IS NOT NULL
       ),
       replies AS (
         SELECT m.lead_id, min(m.created_at) AS first_reply_at
         FROM app.messages m
         JOIN visible v ON v.lead_id = m.lead_id
         WHERE m.direction = 'outbound'
         GROUP BY m.lead_id, date_trunc('day', m.created_at)
       )
       SELECT
         (SELECT count(*) FROM visible WHERE created_at >= (SELECT day_start FROM bounds)) AS new_today,
         (SELECT count(*) FROM visible WHERE created_at >= (SELECT week_start FROM bounds)) AS new_week,
         (SELECT count(*) FROM visible WHERE created_at >= (SELECT month_start FROM bounds)) AS new_month,
         (SELECT count(*) FROM visible WHERE status = 'qualified'
            AND created_at >= (SELECT day_start FROM bounds)) AS qualified_today,
         (SELECT count(*) FROM visible WHERE status = 'qualified'
            AND created_at >= (SELECT week_start FROM bounds)) AS qualified_week,
         (SELECT count(*) FROM visible WHERE status = 'qualified'
            AND created_at >= (SELECT month_start FROM bounds)) AS qualified_month,
         (SELECT count(*) FROM visible WHERE status = 'closed'
            AND created_at >= (SELECT day_start FROM bounds)) AS closed_today,
         (SELECT count(*) FROM visible WHERE status = 'closed'
            AND created_at >= (SELECT week_start FROM bounds)) AS closed_week,
         (SELECT count(*) FROM visible WHERE status = 'closed'
            AND created_at >= (SELECT month_start FROM bounds)) AS closed_month,
         (SELECT count(*) FROM assignments WHERE assigned_at >= (SELECT day_start FROM bounds)) AS unack_today,
         (SELECT count(*) FROM assignments WHERE assigned_at >= (SELECT week_start FROM bounds)) AS unack_week,
         (SELECT count(*) FROM assignments WHERE assigned_at >= (SELECT month_start FROM bounds)) AS unack_month,
         (SELECT count(*) FROM acknowledgements
            WHERE acknowledged_at >= (SELECT day_start FROM bounds)) AS acknowledged_today,
         (SELECT count(*) FROM acknowledgements
            WHERE acknowledged_at >= (SELECT week_start FROM bounds)) AS acknowledged_week,
         (SELECT count(*) FROM acknowledgements
            WHERE acknowledged_at >= (SELECT month_start FROM bounds)) AS acknowledged_month,
         (SELECT count(DISTINCT lead_id) FROM replies
            WHERE first_reply_at >= (SELECT day_start FROM bounds)) AS replied_today,
         (SELECT count(DISTINCT lead_id) FROM replies
            WHERE first_reply_at >= (SELECT week_start FROM bounds)) AS replied_week,
         (SELECT count(DISTINCT lead_id) FROM replies
            WHERE first_reply_at >= (SELECT month_start FROM bounds)) AS replied_month`,
      params.list(),
    );
    const row = result.rows[0];
    const build = (period: 'today' | 'week' | 'month'): PeriodMetrics => {
      const read = (prefix: string): number => Number(row?.[`${prefix}_${period}` as keyof SummaryRow] ?? 0);
      const total = read('new');
      const qualifiedCount = read('qualified');
      return {
        newLeads: total,
        qualifiedLeads: qualifiedCount,
        closedLeads: read('closed'),
        assignedUnacknowledged: read('unack'),
        acknowledged: read('acknowledged'),
        replied: read('replied'),
        conversionRate: ratio(qualifiedCount, total),
      };
    };
    return { today: build('today'), week: build('week'), month: build('month') };
  }

  private async responseTime(scope: DashboardScope): Promise<ResponseTimeMetrics> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const result = await pool.query<{
      avg_first_contact: string | null;
      median_first_contact: string | null;
      slowest_first_contact: string | null;
      avg_ack: string | null;
      median_ack: string | null;
      pending_ack: string;
      oldest_pending_ack: string | null;
    }>(
      `WITH visible AS (
         SELECT l.lead_id, l.first_received_at, l.first_contacted_at
         FROM app.leads l
         WHERE ${visibility}
       ),
       contact AS (
         SELECT extract(epoch FROM (first_contacted_at - first_received_at)) AS delay
         FROM visible
         WHERE first_received_at IS NOT NULL
           AND first_contacted_at IS NOT NULL
           AND first_contacted_at >= first_received_at
       ),
       acknowledged AS (
         SELECT extract(epoch FROM (a.acknowledged_at - a.assigned_at)) AS delay
         FROM app.lead_assignments a
         JOIN visible v ON v.lead_id = a.lead_id
         WHERE a.acknowledged_at IS NOT NULL
       ),
       pending AS (
         SELECT extract(epoch FROM (now() - a.assigned_at)) AS waiting
         FROM app.lead_assignments a
         JOIN visible v ON v.lead_id = a.lead_id
         WHERE a.status = 'assigned' AND a.acknowledged_at IS NULL
       )
       SELECT
         (SELECT avg(delay) FROM contact) AS avg_first_contact,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delay) FROM contact) AS median_first_contact,
         (SELECT max(delay) FROM contact) AS slowest_first_contact,
         (SELECT avg(delay) FROM acknowledged) AS avg_ack,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delay) FROM acknowledged) AS median_ack,
         (SELECT count(*) FROM pending) AS pending_ack,
         (SELECT max(waiting) FROM pending) AS oldest_pending_ack`,
      params.list(),
    );
    const row = result.rows[0];
    return {
      avgFirstContactSeconds: seconds(row?.avg_first_contact ?? null),
      medianFirstContactSeconds: seconds(row?.median_first_contact ?? null),
      slowestFirstContactSeconds: seconds(row?.slowest_first_contact ?? null),
      avgAcknowledgementSeconds: seconds(row?.avg_ack ?? null),
      medianAcknowledgementSeconds: seconds(row?.median_ack ?? null),
      pendingAcknowledgements: Number(row?.pending_ack ?? 0),
      oldestPendingAcknowledgementSeconds: seconds(row?.oldest_pending_ack ?? null),
    };
  }

  private async leadsByTemperature(scope: DashboardScope): Promise<{ temperature: string; count: number }[]> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const result = await pool.query<{ temperature: string; count: string }>(
      `SELECT COALESCE(NULLIF(l.temperature, ''), 'unscored') AS temperature, count(*) AS count
       FROM app.leads l
       WHERE (${visibility}) AND l.status <> 'closed'
       GROUP BY 1
       ORDER BY count DESC, temperature ASC`,
      params.list(),
    );
    return result.rows.map((row) => ({ temperature: row.temperature, count: Number(row.count) }));
  }

  private async leadsBySource(scope: DashboardScope): Promise<{ source: string; count: number }[]> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const result = await pool.query<{ source: string; count: string }>(
      `SELECT COALESCE(NULLIF(l.source, ''), 'unknown') AS source, count(*) AS count
       FROM app.leads l
       WHERE (${visibility}) AND l.created_at >= now() - interval '30 days'
       GROUP BY 1
       ORDER BY count DESC, source ASC`,
      params.list(),
    );
    return result.rows.map((row) => ({ source: row.source, count: Number(row.count) }));
  }

  /**
   * `audit.events.client_id` is not populated by the conversation runtime, so
   * the feed is scoped by resolving each event's aggregate back to a row the
   * session is allowed to see.
   */
  async activity(scope: DashboardScope, limit: number): Promise<ActivityView[]> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const clientParam = params.bind(scope.clientId);
    const limitParam = params.bind(limit);
    const result = await pool.query<{
      audit_event_id: string;
      event_type: string;
      actor_type: string;
      actor_id: string;
      aggregate_type: string;
      aggregate_id: string | null;
      payload_json: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT e.audit_event_id, e.event_type, e.actor_type, e.actor_id,
              e.aggregate_type, e.aggregate_id, e.payload_json, e.created_at
       FROM audit.events e
       WHERE e.aggregate_id IS NOT NULL
         AND e.created_at >= now() - interval '30 days'
         AND (
           EXISTS (SELECT 1 FROM app.leads l WHERE l.lead_id = e.aggregate_id AND (${visibility}))
           OR EXISTS (SELECT 1 FROM app.salespeople sp
                      WHERE sp.salesperson_id = e.aggregate_id AND sp.client_id = ${clientParam}::uuid)
           OR EXISTS (SELECT 1 FROM app.projects pr
                      WHERE pr.project_id = e.aggregate_id AND pr.client_id = ${clientParam}::uuid)
           OR EXISTS (SELECT 1 FROM app.users us
                      WHERE us.user_id = e.aggregate_id AND us.client_id = ${clientParam}::uuid)
         )
       ORDER BY e.created_at DESC, e.audit_event_id DESC
       LIMIT ${limitParam}`,
      params.list(),
    );
    return result.rows.map((row) => ({
      auditEventId: row.audit_event_id,
      eventType: row.event_type,
      actorType: row.actor_type,
      actorId: row.actor_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload_json ?? {},
      createdAt: row.created_at.toISOString(),
    }));
  }
}
