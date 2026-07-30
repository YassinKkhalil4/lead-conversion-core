import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AuditRepository, JobRepository, RuntimeOutboxRepository, type ClaimedJob } from '../infrastructure/runtime.js';
import type { JobProcessingResult } from '../worker/runtime-worker.js';

type Db = typeof pool | PoolClient;

interface DailyReportScheduleResult {
  dailyReportId: string;
  scheduledJobId: string;
  jobKey: string;
  scheduled: boolean;
  skippedReason: string;
}

interface DailyReportSummary {
  reportDate: string;
  timezone: string;
  leadIntakeCount: number;
  newLeadCount: number;
  qualifiedLeadCount: number;
  assignedLeadCount: number;
  acknowledgedAssignmentCount: number;
  unacknowledgedActiveAssignmentCount: number;
  slaEscalationCount: number;
  followupSentCount: number;
  followupCancelledCount: number;
  outboundMessageCount: number;
  deliveredMessageCount: number;
  failedMessageCount: number;
  deadLetterCount: number;
}

function localDate(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export class ReportingService {
  constructor(
    private readonly jobs = new JobRepository(),
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  async scheduleDailyReport(client: Db, input: {
    clientId: string;
    reportDate?: string;
    dueAt?: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<DailyReportScheduleResult> {
    const target = await client.query<{
      client_id: string;
      company_name: string;
      timezone: string;
      manager_phone_e164: string;
      active: boolean;
    }>(
      `SELECT client_id, company_name, timezone, manager_phone_e164, active
       FROM app.clients
       WHERE client_id=$1
       FOR UPDATE`,
      [input.clientId],
    );
    const row = target.rows[0];
    if (!row) throw new Error(`client_not_found_for_daily_report:${input.clientId}`);
    if (!row.active) return this.skippedResult(input.clientId, input.reportDate || localDate(row.timezone), 'client_inactive');

    const reportDate = input.reportDate || localDate(row.timezone);
    const jobKey = `report:daily:${row.client_id}:${reportDate}`;
    const existing = await client.query<{
      daily_report_id: string;
      scheduled_job_id: string | null;
      status: string;
    }>(
      `SELECT daily_report_id, scheduled_job_id, status
       FROM app.daily_reports
       WHERE semantic_key=$1
       FOR UPDATE`,
      [jobKey],
    );
    if (existing.rows[0]) {
      return {
        dailyReportId: existing.rows[0].daily_report_id,
        scheduledJobId: existing.rows[0].scheduled_job_id || '',
        jobKey,
        scheduled: existing.rows[0].status === 'scheduled',
        skippedReason: existing.rows[0].status === 'scheduled' ? '' : `existing_${existing.rows[0].status}`,
      };
    }

    const dueAt = input.dueAt || new Date().toISOString();
    const report = await client.query<{ daily_report_id: string }>(
      `INSERT INTO app.daily_reports
        (client_id, semantic_key, report_date, timezone, recipient_phone_e164)
       VALUES ($1, $2, $3::date, $4, $5)
       RETURNING daily_report_id`,
      [row.client_id, jobKey, reportDate, row.timezone, row.manager_phone_e164],
    );
    const dailyReportId = report.rows[0]?.daily_report_id || '';
    if (!dailyReportId) throw new Error('daily_report_not_created');

    const scheduledJobId = await this.jobs.schedule(client, {
      jobKey,
      jobType: 'report.daily',
      dueAt,
      timezone: row.timezone,
      aggregateKey: row.client_id,
      payload: {
        dailyReportId,
        clientId: row.client_id,
        reportDate,
      },
      recurrence: { kind: 'daily', timezone: row.timezone },
    });
    await client.query(
      'UPDATE app.daily_reports SET scheduled_job_id=$2, updated_at=now() WHERE daily_report_id=$1',
      [dailyReportId, scheduledJobId],
    );
    await this.audit.record(client, {
      eventType: 'report.daily_scheduled',
      actorType: 'worker',
      actorId: input.actorId || 'reporting-service',
      aggregateType: 'client',
      aggregateId: row.client_id,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      payload: {
        dailyReportId,
        scheduledJobId,
        reportDate,
        timezone: row.timezone,
      },
    });
    return { dailyReportId, scheduledJobId, jobKey, scheduled: true, skippedReason: '' };
  }

  async cancelDailyReport(client: Db, input: {
    dailyReportId: string;
    reason: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<boolean> {
    const updated = await client.query<{
      daily_report_id: string;
      client_id: string;
      scheduled_job_id: string | null;
    }>(
      `UPDATE app.daily_reports
       SET status='cancelled',
           cancelled_reason=$2,
           updated_at=now()
       WHERE daily_report_id=$1
         AND status='scheduled'
       RETURNING daily_report_id, client_id, scheduled_job_id`,
      [input.dailyReportId, input.reason.slice(0, 4000)],
    );
    const row = updated.rows[0];
    if (!row) return false;
    if (row.scheduled_job_id) {
      await client.query(
        `UPDATE runtime.scheduled_jobs
         SET status='cancelled',
             cancelled_reason=$2
         WHERE scheduled_job_id=$1
           AND status <> 'completed'`,
        [row.scheduled_job_id, input.reason.slice(0, 4000)],
      );
    }
    await this.audit.record(client, {
      eventType: 'report.daily_cancelled',
      actorType: 'worker',
      actorId: input.actorId || 'reporting-service',
      aggregateType: 'client',
      aggregateId: row.client_id,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      payload: {
        dailyReportId: row.daily_report_id,
        reason: input.reason,
      },
    });
    return true;
  }

  async process(job: ClaimedJob): Promise<JobProcessingResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const report = await client.query<{
        daily_report_id: string;
        client_id: string;
        company_name: string;
        report_date: string;
        timezone: string;
        recipient_phone_e164: string;
        status: string;
      }>(
        `SELECT
           dr.daily_report_id, dr.client_id, c.company_name,
           dr.report_date::text AS report_date, dr.timezone,
           COALESCE(NULLIF(dr.recipient_phone_e164, ''), c.manager_phone_e164) AS recipient_phone_e164,
           dr.status
         FROM app.daily_reports dr
         JOIN app.clients c ON c.client_id=dr.client_id
         WHERE dr.scheduled_job_id=$1
         FOR UPDATE OF dr`,
        [job.scheduledJobId],
      );
      const row = report.rows[0];
      if (!row || row.status !== 'scheduled') {
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }
      if (!row.recipient_phone_e164) {
        await this.cancelMissingDestination(client, row, job.scheduledJobId);
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }

      const summary = await this.generateSummary(client, {
        clientId: row.client_id,
        reportDate: row.report_date,
        timezone: row.timezone,
      });
      const outboxCommandId = await this.outbox.enqueue(client, {
        commandType: 'operator.daily_report',
        destination: row.recipient_phone_e164,
        idempotencyKey: `report.daily:${row.daily_report_id}`,
        aggregateKey: row.client_id,
        payload: {
          dailyReportId: row.daily_report_id,
          clientId: row.client_id,
          companyName: row.company_name,
          reportDate: row.report_date,
          timezone: row.timezone,
          summary,
        },
      });
      await client.query(
        `UPDATE app.daily_reports
         SET status='sent',
             summary_json=$2::jsonb,
             outbox_command_id=$3,
             updated_at=now()
         WHERE daily_report_id=$1`,
        [row.daily_report_id, JSON.stringify(summary), outboxCommandId],
      );
      await this.audit.record(client, {
        eventType: 'report.daily_sent',
        actorType: 'worker',
        actorId: 'reporting-service',
        aggregateType: 'client',
        aggregateId: row.client_id,
        causationId: job.scheduledJobId,
        payload: {
          dailyReportId: row.daily_report_id,
          reportDate: row.report_date,
          outboxCommandId,
        },
      });
      await client.query('COMMIT');
      return { outcome: 'completed' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async generateSummary(client: Db, input: {
    clientId: string;
    reportDate: string;
    timezone: string;
  }): Promise<DailyReportSummary> {
    const base = [input.reportDate, input.clientId, input.timezone] as const;
    const leadIntakeCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.lead_intake_events WHERE client_id=$2 AND (received_at AT TIME ZONE $3)::date=$1::date", base);
    const newLeadCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.leads WHERE client_id=$2 AND (created_at AT TIME ZONE $3)::date=$1::date", base);
    const qualifiedLeadCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.qualification_sessions qs JOIN app.leads l USING (lead_id) WHERE l.client_id=$2 AND qs.completed_at IS NOT NULL AND (qs.completed_at AT TIME ZONE $3)::date=$1::date", base);
    const assignedLeadCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.lead_assignments la JOIN app.leads l USING (lead_id) WHERE l.client_id=$2 AND (la.assigned_at AT TIME ZONE $3)::date=$1::date", base);
    const acknowledgedAssignmentCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.lead_assignments la JOIN app.leads l USING (lead_id) WHERE l.client_id=$2 AND la.acknowledged_at IS NOT NULL AND (la.acknowledged_at AT TIME ZONE $3)::date=$1::date", base);
    const unacknowledgedActiveAssignmentCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.lead_assignments la JOIN app.leads l USING (lead_id) WHERE l.client_id=$2 AND la.status='assigned' AND (la.assigned_at AT TIME ZONE $3)::date <= $1::date AND (la.acknowledged_at IS NULL OR (la.acknowledged_at AT TIME ZONE $3)::date > $1::date)", base);
    const slaEscalationCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.sla_jobs WHERE client_id=$2 AND sla_type IN ('assignment_ack_escalation','stale_qualified_escalation') AND status='sent' AND (updated_at AT TIME ZONE $3)::date=$1::date", base);
    const followupSentCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.followups f JOIN app.leads l USING (lead_id) WHERE l.client_id=$2 AND f.status='sent' AND (f.updated_at AT TIME ZONE $3)::date=$1::date", base);
    const followupCancelledCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.followups f JOIN app.leads l USING (lead_id) WHERE l.client_id=$2 AND f.status='cancelled' AND (f.updated_at AT TIME ZONE $3)::date=$1::date", base);
    const outboundMessageCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.messages WHERE client_id=$2 AND direction='outbound' AND (created_at AT TIME ZONE $3)::date=$1::date", base);
    const deliveredMessageCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.messages WHERE client_id=$2 AND direction='outbound' AND state IN ('delivered','read') AND (created_at AT TIME ZONE $3)::date=$1::date", base);
    const failedMessageCount = await this.count(client, "SELECT count(*)::integer AS count FROM app.messages WHERE client_id=$2 AND direction='outbound' AND state IN ('failed','delivery_unknown') AND (created_at AT TIME ZONE $3)::date=$1::date", base);
    const deadLetterCount = await this.count(client, "SELECT count(*)::integer AS count FROM runtime.dead_letters WHERE (created_at AT TIME ZONE $3)::date=$1::date AND (payload_json->>'clientId'=$2 OR payload_json->>'client_id'=$2)", base);
    return {
      reportDate: input.reportDate,
      timezone: input.timezone,
      leadIntakeCount,
      newLeadCount,
      qualifiedLeadCount,
      assignedLeadCount,
      acknowledgedAssignmentCount,
      unacknowledgedActiveAssignmentCount,
      slaEscalationCount,
      followupSentCount,
      followupCancelledCount,
      outboundMessageCount,
      deliveredMessageCount,
      failedMessageCount,
      deadLetterCount,
    };
  }

  private async count(client: Db, sql: string, values: readonly [string, string, string]): Promise<number> {
    const result = await client.query<{ count: number }>(sql, [...values]);
    return Number(result.rows[0]?.count || 0);
  }

  private async cancelMissingDestination(
    client: Db,
    row: { daily_report_id: string; client_id: string; report_date: string },
    scheduledJobId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE app.daily_reports
       SET status='cancelled',
           cancelled_reason='notification_destination_missing',
           updated_at=now()
       WHERE daily_report_id=$1`,
      [row.daily_report_id],
    );
    await this.audit.record(client, {
      eventType: 'report.daily_cancelled',
      actorType: 'worker',
      actorId: 'reporting-service',
      aggregateType: 'client',
      aggregateId: row.client_id,
      causationId: scheduledJobId,
      payload: {
        dailyReportId: row.daily_report_id,
        reportDate: row.report_date,
        reason: 'notification_destination_missing',
      },
    });
  }

  private skippedResult(clientId: string, reportDate: string, reason: string): DailyReportScheduleResult {
    return {
      dailyReportId: '',
      scheduledJobId: '',
      jobKey: `report:daily:${clientId}:${reportDate}`,
      scheduled: false,
      skippedReason: reason,
    };
  }
}
