import { z } from 'zod';
import { pool } from '../db/pool.js';
import { AuditRepository, sha256Hex, stableJson, type ClaimedInboxEvent } from '../infrastructure/runtime.js';
import type { InboxProcessingResult } from '../worker/runtime-worker.js';
import { FollowupSchedulerService } from './followup-scheduler-service.js';
import { SlaService } from './sla-service.js';

const commandPayloadSchema = z.object({
  webhookType: z.literal('salesperson.command_received'),
  clientId: z.string().uuid().optional(),
  clientRecordId: z.string().min(1).optional(),
  leadId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  fromE164: z.string().min(5),
  messageText: z.string().min(1),
  commandIntent: z.string().optional().default(''),
  sourceEventId: z.string().min(1).optional(),
  receivedAt: z.string().datetime().optional(),
  rawPayload: z.record(z.unknown()).optional().default({}),
});

type CommandPayload = z.infer<typeof commandPayloadSchema>;
type CommandIntent = 'acknowledge' | 'takeover' | 'close_lost' | 'stop_follow_up';

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) return trimmed;
  return `+${trimmed.replace(/[^\d]/g, '')}`;
}

function parseIntent(input: { commandIntent: string; messageText: string }): CommandIntent | null {
  const raw = `${input.commandIntent} ${input.messageText}`.toLocaleLowerCase().trim();
  if (/\back\b|\backnowledge\b|تم|استلمت/.test(raw)) return 'acknowledge';
  if (/\btakeover\b|\bhuman\b|\bmanual\b|تدخل|هستلم/.test(raw)) return 'takeover';
  if (/\bclose[_ -]?lost\b|\blost\b|\bnot interested\b|خسر|مش مهتم/.test(raw)) return 'close_lost';
  if (/\bstop[_ -]?follow\b|\bstop follow\b|\bno follow\b|وقف المتابعة/.test(raw)) return 'stop_follow_up';
  return null;
}

export class SalespersonCommandProcessor {
  constructor(
    private readonly audit = new AuditRepository(),
    private readonly followups = new FollowupSchedulerService(),
    private readonly sla = new SlaService(),
  ) {}

  async process(event: ClaimedInboxEvent): Promise<InboxProcessingResult> {
    if (!['meta'].includes(event.provider) || event.eventType !== 'salesperson.command_received') {
      return { outcome: 'ignored', reason: `unsupported_inbox_event:${event.provider}:${event.eventType}` };
    }
    const parsed = commandPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      return { outcome: 'dead_lettered', reason: `invalid_salesperson_command_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }
    const input = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query<{ salesperson_command_id: string; status: string; outcome_reason: string }>(
        `SELECT salesperson_command_id, status, outcome_reason
         FROM app.salesperson_commands
         WHERE idempotency_key=$1
         LIMIT 1`,
        [this.idempotencyKey(event, input)],
      );
      if (duplicate.rows[0]) {
        await client.query('COMMIT');
        return { outcome: 'processed' };
      }

      const clientId = await this.resolveClientId(client, input);
      const fromPhone = normalizePhone(input.fromE164);
      const salesperson = clientId
        ? await client.query<{ salesperson_id: string }>(
            `SELECT salesperson_id
             FROM app.salespeople
             WHERE client_id=$1 AND phone_e164=$2 AND active=true
             LIMIT 1`,
            [clientId, fromPhone],
          )
        : { rows: [] };
      const salespersonId = salesperson.rows[0]?.salesperson_id || '';
      const assignment = salespersonId
        ? await this.findAssignment(client, {
            clientId,
            salespersonId,
            leadId: input.leadId || '',
            assignmentId: input.assignmentId || '',
          })
        : null;
      const intent = parseIntent({ commandIntent: input.commandIntent, messageText: input.messageText });

      let status: 'processed' | 'rejected' = 'processed';
      let reason = '';
      if (!clientId) {
        status = 'rejected';
        reason = 'client_not_found';
      } else if (!salespersonId) {
        status = 'rejected';
        reason = 'sender_not_active_salesperson';
      } else if (!assignment) {
        status = 'rejected';
        reason = 'sender_not_active_assignee';
      } else if (!intent) {
        status = 'rejected';
        reason = 'unsupported_command_intent';
      }

      if (status === 'processed' && assignment && intent) {
        await this.applyCommand(client, { assignment, intent });
        if (intent === 'acknowledge') {
          await this.sla.cancelForAssignment(client, {
            leadAssignmentId: assignment.lead_assignment_id,
            reason: 'assignment_acknowledged',
            actorId: 'salesperson-command-processor',
            correlationId: event.dedupeKey,
            causationId: event.inboxEventId,
          });
        }
        if (['close_lost', 'stop_follow_up', 'takeover'].includes(intent)) {
          await this.followups.cancelForLead(client, {
            leadId: assignment.lead_id,
            reason: `salesperson_${intent}`,
            actorId: 'salesperson-command-processor',
            correlationId: event.dedupeKey,
            causationId: event.inboxEventId,
          });
          await this.sla.cancelForLead(client, {
            leadId: assignment.lead_id,
            reason: `salesperson_${intent}`,
            actorId: 'salesperson-command-processor',
            correlationId: event.dedupeKey,
            causationId: event.inboxEventId,
          });
        }
        reason = intent;
      }

      const command = await client.query<{ salesperson_command_id: string }>(
        `INSERT INTO app.salesperson_commands
          (lead_assignment_id, lead_id, client_id, salesperson_id, provider, external_event_id,
           idempotency_key, from_phone_e164, command_text, command_intent, status, outcome_reason, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         RETURNING salesperson_command_id`,
        [
          assignment?.lead_assignment_id || null,
          assignment?.lead_id || input.leadId || null,
          clientId || null,
          salespersonId || null,
          event.provider,
          input.sourceEventId || event.dedupeKey,
          this.idempotencyKey(event, input),
          fromPhone,
          input.messageText,
          intent || '',
          status,
          reason,
          JSON.stringify({ ...input.rawPayload, inboxEventId: event.inboxEventId }),
        ],
      );
      const commandId = command.rows[0]?.salesperson_command_id || '';
      if (!commandId) throw new Error('salesperson_command_not_created');

      const aggregateId = assignment?.lead_id || input.leadId || '';
      await this.audit.record(client, {
        eventType: status === 'processed' ? 'salesperson.command_processed' : 'salesperson.command_rejected',
        actorType: 'salesperson',
        actorId: salespersonId || fromPhone,
        aggregateType: 'lead',
        ...(aggregateId ? { aggregateId } : {}),
        correlationId: event.dedupeKey,
        causationId: event.inboxEventId,
        payload: {
          salespersonCommandId: commandId,
          intent: intent || '',
          status,
          reason,
          clientId: clientId || '',
          salespersonId,
        },
      });

      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private idempotencyKey(event: ClaimedInboxEvent, input: CommandPayload): string {
    return input.sourceEventId
      ? `${event.provider}:salesperson_command:${input.sourceEventId}`
      : `${event.provider}:salesperson_command:${sha256Hex(stableJson(input))}`;
  }

  private async resolveClientId(client: typeof pool | import('pg').PoolClient, input: CommandPayload): Promise<string> {
    if (input.clientId) return input.clientId;
    if (!input.clientRecordId) return '';
    const result = await client.query<{ client_id: string }>(
      `SELECT client_id
       FROM app.clients
       WHERE legacy_airtable_id=$1 OR client_key=$1
       LIMIT 1`,
      [input.clientRecordId],
    );
    return result.rows[0]?.client_id || '';
  }

  private async findAssignment(
    client: typeof pool | import('pg').PoolClient,
    input: { clientId: string; salespersonId: string; leadId: string; assignmentId: string },
  ): Promise<{
    lead_assignment_id: string;
    lead_id: string;
    client_id: string;
    salesperson_id: string;
  } | null> {
    const result = await client.query<{
      lead_assignment_id: string;
      lead_id: string;
      client_id: string;
      salesperson_id: string;
    }>(
      `SELECT la.lead_assignment_id, la.lead_id, l.client_id, la.salesperson_id
       FROM app.lead_assignments la
       JOIN app.leads l USING (lead_id)
       WHERE la.salesperson_id=$1
         AND la.status='assigned'
         AND l.client_id=$2
         AND ($3::uuid IS NULL OR la.lead_id=$3)
         AND ($4::uuid IS NULL OR la.lead_assignment_id=$4)
       LIMIT 1
       FOR UPDATE OF la, l`,
      [input.salespersonId, input.clientId, input.leadId || null, input.assignmentId || null],
    );
    return result.rows[0] || null;
  }

  private async applyCommand(
    client: typeof pool | import('pg').PoolClient,
    input: {
      assignment: { lead_assignment_id: string; lead_id: string; client_id: string; salesperson_id: string };
      intent: CommandIntent;
    },
  ): Promise<void> {
    if (input.intent === 'acknowledge') {
      await client.query(
        `UPDATE app.lead_assignments
         SET acknowledged_at=COALESCE(acknowledged_at, now())
         WHERE lead_assignment_id=$1`,
        [input.assignment.lead_assignment_id],
      );
      return;
    }
    if (input.intent === 'takeover') {
      await client.query(
        `UPDATE app.conversations
         SET human_takeover=true, updated_at=now()
         WHERE lead_id=$1`,
        [input.assignment.lead_id],
      );
      await client.query(
        `UPDATE edge_conversations
         SET human_takeover=true, current_stage='human_takeover', updated_at=now()
         WHERE lead_id=$1`,
        [input.assignment.lead_id],
      );
      return;
    }
    if (input.intent === 'stop_follow_up') {
      await client.query(
        `UPDATE app.leads
         SET stop_follow_up=true, stop_reason='salesperson_command', updated_at=now()
         WHERE lead_id=$1`,
        [input.assignment.lead_id],
      );
      await client.query(
        `UPDATE edge_conversations
         SET stop_follow_up=true, updated_at=now()
         WHERE lead_id=$1`,
        [input.assignment.lead_id],
      );
      return;
    }
    await client.query(
      `UPDATE app.leads
       SET status='lost',
           current_stage='closed_lost',
           closed_status='lost',
           stop_follow_up=true,
           stop_reason='salesperson_command',
           updated_at=now()
       WHERE lead_id=$1`,
      [input.assignment.lead_id],
    );
    await client.query(
      `UPDATE app.conversations
       SET status='closed_lost',
           current_stage='closed_lost',
           closed_at=COALESCE(closed_at, now()),
           updated_at=now()
       WHERE lead_id=$1`,
      [input.assignment.lead_id],
    );
    await client.query(
      `UPDATE edge_conversations
       SET status='lost',
           current_stage='closed_lost',
           closed_status='lost',
           stop_follow_up=true,
           updated_at=now()
       WHERE lead_id=$1`,
      [input.assignment.lead_id],
    );
  }
}
