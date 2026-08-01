import { z } from 'zod';
import { pool } from '../db/pool.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex, stableJson, type ClaimedJob } from '../infrastructure/runtime.js';
import type { JobProcessingResult } from '../worker/runtime-worker.js';

const followupJobSchema = z.object({
  leadId: z.string().uuid(),
  followupId: z.string().uuid(),
  sequenceKey: z.string().min(1),
  stageKey: z.string().min(1),
  stepOrder: z.number().int().positive(),
});

export class FollowupJobProcessor {
  constructor(
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  async process(job: ClaimedJob): Promise<JobProcessingResult> {
    const parsed = followupJobSchema.safeParse(job.payload);
    if (!parsed.success) {
      return { outcome: 'dead_lettered', reason: `invalid_followup_job_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }
    const input = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const followup = await client.query<{
        followup_id: string;
        lead_id: string;
        status: string;
        client_id: string;
        contact_id: string;
        phone_e164: string;
        name: string;
        lead_status: string;
        current_stage: string;
        stop_follow_up: boolean;
        active_assignment_count: string;
        human_takeover: boolean;
      }>(
        `SELECT
           f.followup_id, f.lead_id, f.status,
           l.client_id, l.contact_id, c.phone_e164, c.name,
           l.status AS lead_status, l.current_stage, l.stop_follow_up,
           (SELECT count(*)::text FROM app.lead_assignments la WHERE la.lead_id=l.lead_id AND la.status='assigned') AS active_assignment_count,
           COALESCE((SELECT bool_or(conv.human_takeover) FROM app.conversations conv WHERE conv.lead_id=l.lead_id), false) AS human_takeover
         FROM app.followups f
         JOIN app.leads l USING (lead_id)
         JOIN app.contacts c USING (contact_id)
         WHERE f.followup_id=$1
           AND f.scheduled_job_id=$2
         FOR UPDATE OF f, l`,
        [input.followupId, job.scheduledJobId],
      );
      const row = followup.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }
      if (row.status !== 'scheduled') {
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }
      const skipReason = this.skipReason(row);
      if (skipReason) {
        await client.query(
          `UPDATE app.followups
           SET status='cancelled',
               cancelled_reason=$2,
               updated_at=now()
           WHERE followup_id=$1`,
          [row.followup_id, skipReason],
        );
        await this.audit.record(client, {
          eventType: 'followup.cancelled',
          actorType: 'worker',
          actorId: 'followup-job-processor',
          aggregateType: 'lead',
          aggregateId: row.lead_id,
          causationId: job.scheduledJobId,
          payload: { followupId: row.followup_id, reason: skipReason },
        });
        await client.query('COMMIT');
        return { outcome: 'completed' };
      }

      const text = `Following up on your enquiry${row.name ? `, ${row.name}` : ''}. Reply here if you would like help from the team.`;
      const idempotencyKey = `followup.send:${row.followup_id}:${sha256Hex(stableJson({ text, to: row.phone_e164 })).slice(0, 24)}`;
      const message = await client.query<{ message_id: string }>(
        `INSERT INTO app.messages
          (lead_id, client_id, contact_id, direction, channel, to_address,
           message_text, message_type, state, raw_payload, idempotency_key)
         VALUES ($1,$2,$3,'outbound','whatsapp',$4,$5,'text','queued',$6::jsonb,$7)
         ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key <> ''
         DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING message_id`,
        [
          row.lead_id,
          row.client_id,
          row.contact_id,
          row.phone_e164,
          text,
          JSON.stringify({
            source: 'followup_job',
            followupId: row.followup_id,
            scheduledJobId: job.scheduledJobId,
          }),
          idempotencyKey,
        ],
      );
      const messageId = message.rows[0]?.message_id || '';
      if (!messageId) throw new Error('followup_message_not_created');
      await this.outbox.enqueue(client, {
        commandType: 'whatsapp.send_message',
        destination: row.phone_e164,
        idempotencyKey,
        aggregateKey: row.lead_id,
        payload: {
          provider: 'meta',
          phoneNumberId: '',
          toE164: row.phone_e164,
          message: { kind: 'text', text },
          messageId,
          leadId: row.lead_id,
          followupId: row.followup_id,
        },
      });
      await client.query(
        `UPDATE app.followups
         SET status='sent',
             sent_message_id=$2,
             updated_at=now()
         WHERE followup_id=$1`,
        [row.followup_id, messageId],
      );
      await this.audit.record(client, {
        eventType: 'followup.sent',
        actorType: 'worker',
        actorId: 'followup-job-processor',
        aggregateType: 'lead',
        aggregateId: row.lead_id,
        causationId: job.scheduledJobId,
        payload: {
          followupId: row.followup_id,
          messageId,
          idempotencyKey,
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

  private skipReason(row: {
    lead_status: string;
    current_stage: string;
    stop_follow_up: boolean;
    active_assignment_count: string;
    human_takeover: boolean;
  }): string {
    const status = row.lead_status.toLocaleLowerCase();
    const stage = row.current_stage.toLocaleLowerCase();
    if (row.stop_follow_up) return 'stop_follow_up_true';
    if (row.human_takeover) return 'human_takeover';
    if (Number(row.active_assignment_count) > 0) return 'lead_assigned';
    if (['qualified', 'closed_lost', 'stopped'].includes(stage)) return `stage_${stage}`;
    if (['qualified', 'lost', 'not_interested'].includes(status)) return `status_${status}`;
    return '';
  }
}
