import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AuditRepository, JobRepository } from '../infrastructure/runtime.js';

type Db = typeof pool | PoolClient;

interface ScheduleFollowupResult {
  followupId: string;
  scheduledJobId: string;
  jobKey: string;
  scheduled: boolean;
  skippedReason: string;
}

export class FollowupSchedulerService {
  constructor(
    private readonly jobs = new JobRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  async scheduleFollowup(client: Db, input: {
    leadId: string;
    stageKey: string;
    sequenceKey?: string;
    stepOrder?: number;
    delaySeconds: number;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<ScheduleFollowupResult> {
    const lead = await client.query<{
      lead_id: string;
      client_id: string;
      status: string;
      current_stage: string;
      stop_follow_up: boolean;
      timezone: string;
      active_assignment_count: string;
      human_takeover: boolean;
    }>(
      `SELECT
         l.lead_id, l.client_id, l.status, l.current_stage, l.stop_follow_up,
         c.timezone,
         (SELECT count(*)::text FROM app.lead_assignments la WHERE la.lead_id=l.lead_id AND la.status='assigned') AS active_assignment_count,
         COALESCE((SELECT bool_or(conv.human_takeover) FROM app.conversations conv WHERE conv.lead_id=l.lead_id), false) AS human_takeover
       FROM app.leads l
       JOIN app.clients c USING (client_id)
       WHERE l.lead_id=$1
       FOR UPDATE OF l`,
      [input.leadId],
    );
    const row = lead.rows[0];
    if (!row) throw new Error(`lead_not_found_for_followup:${input.leadId}`);
    const skippedReason = this.skipReason(row);
    const sequenceKey = input.sequenceKey || 'default';
    const stepOrder = input.stepOrder || 1;
    const jobKey = `followup:${input.leadId}:${sequenceKey}:${input.stageKey}:step:${stepOrder}`;
    if (skippedReason) {
      return { followupId: '', scheduledJobId: '', jobKey, scheduled: false, skippedReason };
    }
    const existing = await client.query<{
      followup_id: string;
      scheduled_job_id: string | null;
      status: string;
    }>(
      `SELECT followup_id, scheduled_job_id, status
       FROM app.followups
       WHERE semantic_key=$1
       FOR UPDATE`,
      [jobKey],
    );
    if (existing.rows[0]) {
      return {
        followupId: existing.rows[0].followup_id,
        scheduledJobId: existing.rows[0].scheduled_job_id || '',
        jobKey,
        scheduled: existing.rows[0].status === 'scheduled',
        skippedReason: existing.rows[0].status === 'scheduled' ? '' : `existing_${existing.rows[0].status}`,
      };
    }

    const dueAt = new Date(Date.now() + input.delaySeconds * 1000).toISOString();
    const followup = await client.query<{ followup_id: string }>(
      `INSERT INTO app.followups
        (lead_id, status, due_at, semantic_key, timezone, sequence_key, step_order)
       VALUES ($1, 'scheduled', $2::timestamptz, $3, $4, $5, $6)
       RETURNING followup_id`,
      [input.leadId, dueAt, jobKey, row.timezone, sequenceKey, stepOrder],
    );
    const followupId = followup.rows[0]?.followup_id || '';
    if (!followupId) throw new Error('followup_not_created');

    const scheduledJobId = await this.jobs.schedule(client, {
      jobKey,
      jobType: 'followup.send',
      dueAt,
      timezone: row.timezone,
      aggregateKey: input.leadId,
      payload: {
        leadId: input.leadId,
        followupId,
        sequenceKey,
        stageKey: input.stageKey,
        stepOrder,
      },
    });
    await client.query(
      `UPDATE app.followups
       SET scheduled_job_id=$2, updated_at=now()
       WHERE followup_id=$1`,
      [followupId, scheduledJobId],
    );
    await this.audit.record(client, {
      eventType: 'followup.scheduled',
      actorType: 'worker',
      actorId: input.actorId || 'followup-scheduler-service',
      aggregateType: 'lead',
      aggregateId: input.leadId,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      causationId: input.causationId || scheduledJobId,
      payload: {
        followupId,
        scheduledJobId,
        jobKey,
        dueAt,
        timezone: row.timezone,
      },
    });
    return { followupId, scheduledJobId, jobKey, scheduled: true, skippedReason: '' };
  }

  async cancelForLead(client: Db, input: {
    leadId: string;
    reason: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<number> {
    const updated = await client.query<{ followup_id: string; semantic_key: string; scheduled_job_id: string | null }>(
      `UPDATE app.followups
       SET status='cancelled',
           cancelled_reason=$2,
           updated_at=now()
       WHERE lead_id=$1
         AND status='scheduled'
       RETURNING followup_id, semantic_key, scheduled_job_id`,
      [input.leadId, input.reason.slice(0, 4000)],
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
      eventType: 'followup.cancelled',
      actorType: 'worker',
      actorId: input.actorId || 'followup-scheduler-service',
      aggregateType: 'lead',
      aggregateId: input.leadId,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId || updated.rows[0]?.followup_id ? { causationId: input.causationId || updated.rows[0]?.followup_id || '' } : {}),
      payload: {
        reason: input.reason,
        count: updated.rows.length,
        jobKeys: updated.rows.map((row) => row.semantic_key),
      },
    });
    return updated.rows.length;
  }

  private skipReason(row: {
    status: string;
    current_stage: string;
    stop_follow_up: boolean;
    active_assignment_count: string;
    human_takeover: boolean;
  }): string {
    const status = row.status.toLocaleLowerCase();
    const stage = row.current_stage.toLocaleLowerCase();
    if (row.stop_follow_up) return 'stop_follow_up_true';
    if (row.human_takeover) return 'human_takeover';
    if (Number(row.active_assignment_count) > 0) return 'lead_assigned';
    if (['qualified', 'closed_lost', 'stopped'].includes(stage)) return `stage_${stage}`;
    if (['qualified', 'lost', 'not_interested'].includes(status)) return `status_${status}`;
    return '';
  }
}
