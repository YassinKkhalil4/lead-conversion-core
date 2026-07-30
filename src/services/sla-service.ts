import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AuditRepository, JobRepository, RuntimeOutboxRepository, type ClaimedJob } from '../infrastructure/runtime.js';
import type { JobProcessingResult } from '../worker/runtime-worker.js';

type Db = typeof pool | PoolClient;
type SlaType = 'assignment_ack_reminder' | 'assignment_ack_escalation' | 'stale_qualified_escalation';

const ASSIGNMENT_ACK_REMINDER_DELAY_SECONDS = 15 * 60;
const ASSIGNMENT_ACK_ESCALATION_DELAY_SECONDS = 30 * 60;
const STALE_QUALIFIED_ESCALATION_DELAY_SECONDS = 60 * 60;

interface SlaScheduleResult {
  slaJobId: string;
  scheduledJobId: string;
  jobKey: string;
  scheduled: boolean;
  skippedReason: string;
}

export class SlaService {
  constructor(
    private readonly jobs = new JobRepository(),
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  async scheduleForAssignment(client: Db, input: {
    leadAssignmentId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<SlaScheduleResult[]> {
    const assignment = await client.query<{
      lead_assignment_id: string;
      lead_id: string;
      salesperson_id: string;
      client_id: string;
      timezone: string;
      acknowledged_at: Date | null;
      status: string;
      lead_status: string;
      stop_follow_up: boolean;
    }>(
      `SELECT
         la.lead_assignment_id, la.lead_id, la.salesperson_id, l.client_id, c.timezone,
         la.acknowledged_at, la.status, l.status AS lead_status, l.stop_follow_up
       FROM app.lead_assignments la
       JOIN app.leads l USING (lead_id)
       JOIN app.clients c USING (client_id)
       WHERE la.lead_assignment_id=$1
       FOR UPDATE OF la, l`,
      [input.leadAssignmentId],
    );
    const row = assignment.rows[0];
    if (!row) throw new Error(`assignment_not_found_for_sla:${input.leadAssignmentId}`);
    const skip = this.assignmentSkipReason(row);
    if (skip) {
      return [
        this.skippedResult(row.lead_id, 'assignment_ack_reminder', skip),
        this.skippedResult(row.lead_id, 'assignment_ack_escalation', skip),
      ];
    }
    return [
      await this.scheduleJob(client, {
        leadId: row.lead_id,
        clientId: row.client_id,
        salespersonId: row.salesperson_id,
        leadAssignmentId: row.lead_assignment_id,
        slaType: 'assignment_ack_reminder',
        delaySeconds: ASSIGNMENT_ACK_REMINDER_DELAY_SECONDS,
        timezone: row.timezone,
        actorId: input.actorId || 'sla-service',
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
      }),
      await this.scheduleJob(client, {
        leadId: row.lead_id,
        clientId: row.client_id,
        salespersonId: row.salesperson_id,
        leadAssignmentId: row.lead_assignment_id,
        slaType: 'assignment_ack_escalation',
        delaySeconds: ASSIGNMENT_ACK_ESCALATION_DELAY_SECONDS,
        timezone: row.timezone,
        actorId: input.actorId || 'sla-service',
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
      }),
    ];
  }

  async scheduleStaleQualifiedLead(client: Db, input: {
    leadId: string;
    delaySeconds?: number;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<SlaScheduleResult> {
    const lead = await client.query<{
      lead_id: string;
      client_id: string;
      timezone: string;
      status: string;
      current_stage: string;
      stop_follow_up: boolean;
      active_assignment_count: string;
    }>(
      `SELECT
         l.lead_id, l.client_id, c.timezone, l.status, l.current_stage, l.stop_follow_up,
         (SELECT count(*)::text FROM app.lead_assignments la WHERE la.lead_id=l.lead_id AND la.status='assigned') AS active_assignment_count
       FROM app.leads l
       JOIN app.clients c USING (client_id)
       WHERE l.lead_id=$1
       FOR UPDATE OF l`,
      [input.leadId],
    );
    const row = lead.rows[0];
    if (!row) throw new Error(`lead_not_found_for_stale_sla:${input.leadId}`);
    const skip = this.staleLeadSkipReason(row);
    if (skip) return this.skippedResult(input.leadId, 'stale_qualified_escalation', skip);
    return this.scheduleJob(client, {
      leadId: row.lead_id,
      clientId: row.client_id,
      salespersonId: '',
      leadAssignmentId: '',
      slaType: 'stale_qualified_escalation',
      delaySeconds: input.delaySeconds ?? STALE_QUALIFIED_ESCALATION_DELAY_SECONDS,
      timezone: row.timezone,
      actorId: input.actorId || 'sla-service',
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
    });
  }

  async cancelForLead(client: Db, input: {
    leadId: string;
    reason: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<number> {
    return this.cancel(client, {
      whereSql: 'lead_id=$1',
      whereParams: [input.leadId],
      reason: input.reason,
      aggregateId: input.leadId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
    });
  }

  async cancelForAssignment(client: Db, input: {
    leadAssignmentId: string;
    reason: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<number> {
    const assignment = await client.query<{ lead_id: string }>(
      'SELECT lead_id FROM app.lead_assignments WHERE lead_assignment_id=$1',
      [input.leadAssignmentId],
    );
    const leadId = assignment.rows[0]?.lead_id || '';
    return this.cancel(client, {
      whereSql: 'lead_assignment_id=$1',
      whereParams: [input.leadAssignmentId],
      reason: input.reason,
      aggregateId: leadId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
    });
  }

  async process(job: ClaimedJob): Promise<JobProcessingResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sla = await client.query<{
        sla_job_id: string;
        lead_id: string;
        lead_assignment_id: string | null;
        client_id: string;
        salesperson_id: string | null;
        sla_type: SlaType;
        status: string;
        salesperson_phone: string | null;
        manager_phone_e164: string;
        acknowledged_at: Date | null;
        assignment_status: string | null;
        lead_status: string;
        current_stage: string;
        stop_follow_up: boolean;
        contact_name: string;
        contact_phone: string;
      }>(
        `SELECT
           sj.sla_job_id, sj.lead_id, sj.lead_assignment_id, sj.client_id, sj.salesperson_id,
           sj.sla_type, sj.status,
           sp.phone_e164 AS salesperson_phone,
           c.manager_phone_e164,
           la.acknowledged_at,
           la.status AS assignment_status,
           l.status AS lead_status,
           l.current_stage,
           l.stop_follow_up,
           ct.name AS contact_name,
           ct.phone_e164 AS contact_phone
         FROM app.sla_jobs sj
         JOIN app.leads l ON l.lead_id=sj.lead_id
         JOIN app.clients c ON c.client_id=sj.client_id
         JOIN app.contacts ct ON ct.contact_id=l.contact_id
         LEFT JOIN app.lead_assignments la ON la.lead_assignment_id=sj.lead_assignment_id
         LEFT JOIN app.salespeople sp ON sp.salesperson_id=sj.salesperson_id
         WHERE sj.scheduled_job_id=$1
         FOR UPDATE OF sj, l`,
        [job.scheduledJobId],
      );
      const row = sla.rows[0];
      if (!row || row.status !== 'scheduled') {
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }
      const skip = this.executionSkipReason(row);
      if (skip) {
        await this.cancelSlaRow(client, row.sla_job_id, skip);
        await this.audit.record(client, {
          eventType: 'sla.cancelled',
          actorType: 'worker',
          actorId: 'sla-service',
          aggregateType: 'lead',
          aggregateId: row.lead_id,
          causationId: job.scheduledJobId,
          payload: { slaJobId: row.sla_job_id, reason: skip },
        });
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }
      const command = this.commandFor(row);
      if (!command.destination) {
        await this.cancelSlaRow(client, row.sla_job_id, 'notification_destination_missing');
        await this.audit.record(client, {
          eventType: 'sla.cancelled',
          actorType: 'worker',
          actorId: 'sla-service',
          aggregateType: 'lead',
          aggregateId: row.lead_id,
          causationId: job.scheduledJobId,
          payload: { slaJobId: row.sla_job_id, reason: 'notification_destination_missing' },
        });
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }
      const outboxCommandId = await this.outbox.enqueue(client, {
        commandType: command.commandType,
        destination: command.destination,
        idempotencyKey: `sla.notify:${row.sla_job_id}`,
        aggregateKey: row.lead_id,
        payload: command.payload,
      });
      await client.query(
        `UPDATE app.sla_jobs
         SET status='sent',
             outbox_command_id=$2,
             updated_at=now()
         WHERE sla_job_id=$1`,
        [row.sla_job_id, outboxCommandId],
      );
      await this.audit.record(client, {
        eventType: 'sla.sent',
        actorType: 'worker',
        actorId: 'sla-service',
        aggregateType: 'lead',
        aggregateId: row.lead_id,
        causationId: job.scheduledJobId,
        payload: {
          slaJobId: row.sla_job_id,
          slaType: row.sla_type,
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

  private async scheduleJob(client: Db, input: {
    leadId: string;
    clientId: string;
    salespersonId: string;
    leadAssignmentId: string;
    slaType: SlaType;
    delaySeconds: number;
    timezone: string;
    actorId: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<SlaScheduleResult> {
    const jobKey = input.leadAssignmentId
      ? `sla:${input.slaType}:assignment:${input.leadAssignmentId}`
      : `sla:${input.slaType}:lead:${input.leadId}`;
    const existing = await client.query<{ sla_job_id: string; scheduled_job_id: string | null; status: string }>(
      `SELECT sla_job_id, scheduled_job_id, status
       FROM app.sla_jobs
       WHERE semantic_key=$1
       FOR UPDATE`,
      [jobKey],
    );
    if (existing.rows[0]) {
      return {
        slaJobId: existing.rows[0].sla_job_id,
        scheduledJobId: existing.rows[0].scheduled_job_id || '',
        jobKey,
        scheduled: existing.rows[0].status === 'scheduled',
        skippedReason: existing.rows[0].status === 'scheduled' ? '' : `existing_${existing.rows[0].status}`,
      };
    }
    const dueAt = new Date(Date.now() + input.delaySeconds * 1000).toISOString();
    const sla = await client.query<{ sla_job_id: string }>(
      `INSERT INTO app.sla_jobs
        (lead_id, lead_assignment_id, client_id, salesperson_id, semantic_key, sla_type, due_at, timezone)
       VALUES ($1, NULLIF($2, '')::uuid, $3, NULLIF($4, '')::uuid, $5, $6, $7::timestamptz, $8)
       RETURNING sla_job_id`,
      [
        input.leadId,
        input.leadAssignmentId,
        input.clientId,
        input.salespersonId,
        jobKey,
        input.slaType,
        dueAt,
        input.timezone,
      ],
    );
    const slaJobId = sla.rows[0]?.sla_job_id || '';
    if (!slaJobId) throw new Error('sla_job_not_created');
    const scheduledJobId = await this.jobs.schedule(client, {
      jobKey,
      jobType: 'sla.notify',
      dueAt,
      timezone: input.timezone,
      aggregateKey: input.leadId,
      payload: {
        slaJobId,
        leadId: input.leadId,
        leadAssignmentId: input.leadAssignmentId,
        slaType: input.slaType,
      },
    });
    await client.query('UPDATE app.sla_jobs SET scheduled_job_id=$2, updated_at=now() WHERE sla_job_id=$1', [slaJobId, scheduledJobId]);
    await this.audit.record(client, {
      eventType: 'sla.scheduled',
      actorType: 'worker',
      actorId: input.actorId,
      aggregateType: 'lead',
      aggregateId: input.leadId,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      payload: {
        slaJobId,
        scheduledJobId,
        jobKey,
        slaType: input.slaType,
        dueAt,
        timezone: input.timezone,
      },
    });
    return { slaJobId, scheduledJobId, jobKey, scheduled: true, skippedReason: '' };
  }

  private async cancel(client: Db, input: {
    whereSql: string;
    whereParams: string[];
    reason: string;
    aggregateId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<number> {
    const updated = await client.query<{ sla_job_id: string; semantic_key: string; scheduled_job_id: string | null }>(
      `UPDATE app.sla_jobs
       SET status='cancelled',
           cancelled_reason=$${input.whereParams.length + 1},
           updated_at=now()
       WHERE ${input.whereSql}
         AND status='scheduled'
       RETURNING sla_job_id, semantic_key, scheduled_job_id`,
      [...input.whereParams, input.reason.slice(0, 4000)],
    );
    if (updated.rows.length === 0) return 0;
    await client.query(
      `UPDATE runtime.scheduled_jobs
       SET status='cancelled',
           cancelled_reason=$2
       WHERE scheduled_job_id = ANY($1::uuid[])
         AND status <> 'completed'`,
      [updated.rows.map((row) => row.scheduled_job_id).filter(Boolean), input.reason.slice(0, 4000)],
    );
    await this.audit.record(client, {
      eventType: 'sla.cancelled',
      actorType: 'worker',
      actorId: input.actorId || 'sla-service',
      aggregateType: 'lead',
      ...(input.aggregateId ? { aggregateId: input.aggregateId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      payload: {
        reason: input.reason,
        count: updated.rows.length,
        jobKeys: updated.rows.map((row) => row.semantic_key),
      },
    });
    return updated.rows.length;
  }

  private async cancelSlaRow(client: Db, slaJobId: string, reason: string): Promise<void> {
    await client.query(
      `UPDATE app.sla_jobs
       SET status='cancelled',
           cancelled_reason=$2,
           updated_at=now()
       WHERE sla_job_id=$1`,
      [slaJobId, reason.slice(0, 4000)],
    );
  }

  private assignmentSkipReason(row: {
    acknowledged_at: Date | null;
    status: string;
    lead_status: string;
    stop_follow_up: boolean;
  }): string {
    if (row.acknowledged_at) return 'assignment_acknowledged';
    if (row.status !== 'assigned') return `assignment_${row.status}`;
    if (row.stop_follow_up) return 'stop_follow_up_true';
    if (['lost', 'not_interested'].includes(row.lead_status.toLocaleLowerCase())) return `lead_${row.lead_status}`;
    return '';
  }

  private staleLeadSkipReason(row: {
    status: string;
    current_stage: string;
    stop_follow_up: boolean;
    active_assignment_count: string;
  }): string {
    if (row.stop_follow_up) return 'stop_follow_up_true';
    if (Number(row.active_assignment_count) > 0) return 'lead_assigned';
    if (row.status !== 'qualified' && row.current_stage !== 'qualified') return 'lead_not_qualified';
    return '';
  }

  private executionSkipReason(row: {
    acknowledged_at: Date | null;
    assignment_status: string | null;
    lead_status: string;
    current_stage: string;
    stop_follow_up: boolean;
    sla_type: SlaType;
  }): string {
    if (row.stop_follow_up) return 'stop_follow_up_true';
    if (['lost', 'not_interested'].includes(row.lead_status.toLocaleLowerCase())) return `lead_${row.lead_status}`;
    if (row.sla_type === 'stale_qualified_escalation') {
      if (row.lead_status !== 'qualified' && row.current_stage !== 'qualified') return 'lead_not_qualified';
      return '';
    }
    if (row.acknowledged_at) return 'assignment_acknowledged';
    if (row.assignment_status !== 'assigned') return `assignment_${row.assignment_status || 'missing'}`;
    return '';
  }

  private commandFor(row: {
    sla_type: SlaType;
    sla_job_id: string;
    lead_id: string;
    lead_assignment_id: string | null;
    salesperson_id: string | null;
    salesperson_phone: string | null;
    manager_phone_e164: string;
    contact_name: string;
    contact_phone: string;
  }): {
    commandType: string;
    destination: string;
    payload: Record<string, unknown>;
  } {
    if (row.sla_type === 'assignment_ack_reminder') {
      return {
        commandType: 'salesperson.sla_assignment_reminder',
        destination: row.salesperson_phone || '',
        payload: {
          slaJobId: row.sla_job_id,
          leadId: row.lead_id,
          assignmentId: row.lead_assignment_id || '',
          salespersonId: row.salesperson_id || '',
          contactName: row.contact_name,
          contactPhoneE164: row.contact_phone,
        },
      };
    }
    return {
      commandType: 'operator.sla_escalation',
      destination: row.manager_phone_e164,
      payload: {
        slaJobId: row.sla_job_id,
        slaType: row.sla_type,
        leadId: row.lead_id,
        assignmentId: row.lead_assignment_id || '',
        salespersonId: row.salesperson_id || '',
        contactName: row.contact_name,
        contactPhoneE164: row.contact_phone,
        reason: row.sla_type === 'stale_qualified_escalation' ? 'stale_qualified_lead' : 'assignment_not_acknowledged',
      },
    };
  }

  private skippedResult(leadId: string, slaType: SlaType, reason: string): SlaScheduleResult {
    return {
      slaJobId: '',
      scheduledJobId: '',
      jobKey: `sla:${slaType}:lead:${leadId}`,
      scheduled: false,
      skippedReason: reason,
    };
  }
}
