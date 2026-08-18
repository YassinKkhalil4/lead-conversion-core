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
  /** The slow tail. An average hides the cases that lose deals; p90 does not. */
  p90FirstContactSeconds: number | null;
  slowestFirstContactSeconds: number | null;
  /** Assignment to salesperson acknowledgement. */
  avgAcknowledgementSeconds: number | null;
  medianAcknowledgementSeconds: number | null;
  p90AcknowledgementSeconds: number | null;
  slowestAcknowledgementSeconds: number | null;
  /** Assignments still unacknowledged right now, and the oldest of them. */
  pendingAcknowledgements: number;
  oldestPendingAcknowledgementSeconds: number | null;
}

export interface DashboardSummary {
  timezone: string;
  generatedAt: string;
  periods: { today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics };
  /**
   * The same metrics for the period immediately before each one — yesterday,
   * last week, last month — so a figure can be shown with a direction rather
   * than as a number with no reference point.
   */
  previousPeriods: { today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics };
  responseTime: ResponseTimeMetrics;
  leadsByTemperature: { temperature: string; count: number }[];
  leadsBySource: { source: string; count: number }[];
}

const PERIODS = ['day', 'week', 'month'] as const;
const PHASES = ['current', 'previous'] as const;
type Period = (typeof PERIODS)[number];
type Phase = (typeof PHASES)[number];

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
      periods: counts.current,
      previousPeriods: counts.previous,
      responseTime,
      leadsByTemperature: temperature,
      leadsBySource: source,
    };
  }

  private async periodCounts(
    scope: DashboardScope,
    timezone: string,
  ): Promise<{ current: DashboardSummary['periods']; previous: DashboardSummary['periods'] }> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const tz = params.bind(timezone);

    // Each metric is counted twice: once over the period so far, and once over
    // the whole of the period before it. The previous window is closed at the
    // current window's start so the two never overlap.
    const windows = (period: Period, phase: Phase): { from: string; to: string } =>
      phase === 'current'
        ? { from: `(SELECT ${period}_start FROM bounds)`, to: 'now()' }
        : { from: `(SELECT prev_${period}_start FROM bounds)`, to: `(SELECT ${period}_start FROM bounds)` };

    const columns: string[] = [];
    for (const period of PERIODS) {
      for (const phase of PHASES) {
        const { from, to } = windows(period, phase);
        const suffix = `${period}_${phase}`;
        const between = (column: string) => `${column} >= ${from} AND ${column} < ${to}`;
        columns.push(
          `(SELECT count(*) FROM visible WHERE ${between('created_at')}) AS new_${suffix}`,
          `(SELECT count(*) FROM visible WHERE status = 'qualified' AND ${between('created_at')}) AS qualified_${suffix}`,
          `(SELECT count(*) FROM visible WHERE status = 'closed' AND ${between('created_at')}) AS closed_${suffix}`,
          `(SELECT count(*) FROM assignments WHERE ${between('assigned_at')}) AS unack_${suffix}`,
          `(SELECT count(*) FROM acknowledgements WHERE ${between('acknowledged_at')}) AS acknowledged_${suffix}`,
          `(SELECT count(DISTINCT lead_id) FROM replies WHERE ${between('first_reply_at')}) AS replied_${suffix}`,
        );
      }
    }

    const result = await pool.query<Record<string, string>>(
      `WITH bounds AS (
         SELECT
           (date_trunc('day',   now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS day_start,
           (date_trunc('week',  now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS week_start,
           (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS month_start,
           ((date_trunc('day',   now() AT TIME ZONE ${tz}) - interval '1 day')   AT TIME ZONE ${tz}) AS prev_day_start,
           ((date_trunc('week',  now() AT TIME ZONE ${tz}) - interval '1 week')  AT TIME ZONE ${tz}) AS prev_week_start,
           ((date_trunc('month', now() AT TIME ZONE ${tz}) - interval '1 month') AT TIME ZONE ${tz}) AS prev_month_start
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
       SELECT ${columns.join(',\n         ')}`,
      params.list(),
    );

    const row = result.rows[0];
    const build = (period: Period, phase: Phase): PeriodMetrics => {
      const read = (prefix: string): number => Number(row?.[`${prefix}_${period}_${phase}`] ?? 0);
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

    const forPhase = (phase: Phase): DashboardSummary['periods'] => ({
      today: build('day', phase),
      week: build('week', phase),
      month: build('month', phase),
    });

    return { current: forPhase('current'), previous: forPhase('previous') };
  }

  private async responseTime(scope: DashboardScope): Promise<ResponseTimeMetrics> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const result = await pool.query<{
      avg_first_contact: string | null;
      median_first_contact: string | null;
      p90_first_contact: string | null;
      slowest_first_contact: string | null;
      avg_ack: string | null;
      median_ack: string | null;
      p90_ack: string | null;
      slowest_ack: string | null;
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
         (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY delay) FROM contact) AS p90_first_contact,
         (SELECT max(delay) FROM contact) AS slowest_first_contact,
         (SELECT avg(delay) FROM acknowledged) AS avg_ack,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delay) FROM acknowledged) AS median_ack,
         (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY delay) FROM acknowledged) AS p90_ack,
         (SELECT max(delay) FROM acknowledged) AS slowest_ack,
         (SELECT count(*) FROM pending) AS pending_ack,
         (SELECT max(waiting) FROM pending) AS oldest_pending_ack`,
      params.list(),
    );
    const row = result.rows[0];
    return {
      avgFirstContactSeconds: seconds(row?.avg_first_contact ?? null),
      medianFirstContactSeconds: seconds(row?.median_first_contact ?? null),
      p90FirstContactSeconds: seconds(row?.p90_first_contact ?? null),
      slowestFirstContactSeconds: seconds(row?.slowest_first_contact ?? null),
      avgAcknowledgementSeconds: seconds(row?.avg_ack ?? null),
      medianAcknowledgementSeconds: seconds(row?.median_ack ?? null),
      p90AcknowledgementSeconds: seconds(row?.p90_ack ?? null),
      slowestAcknowledgementSeconds: seconds(row?.slowest_ack ?? null),
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
