import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { AuditRepository } from '../../infrastructure/runtime.js';
import { FollowupSchedulerService } from '../followup-scheduler-service.js';
import { MessageRequestService } from '../message-request-service.js';
import { SlaService } from '../sla-service.js';
import { DashboardLeadListService, type LeadListItem } from './lead-list-service.js';
import { leadVisibilitySql, QueryParams } from './sql.js';
import { badRequest, conflict, type DashboardScope, type DashboardUser, forbidden, notFound } from './types.js';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

interface LeadRecord {
  lead_id: string;
  client_id: string;
  contact_id: string;
  status: string;
  pipeline_stage: string;
  stop_follow_up: boolean;
  closed_status: string;
  contact_phone: string;
  client_record_id: string;
  conversation_id: string | null;
  last_inbound_at: Date | null;
  conversation_window_expires_at: Date | null;
}

/**
 * Resolves the conversation-state key the engine uses. `edge_conversations`
 * rows are keyed by (client_record_id, phone_normalized), and the phone key is
 * whatever the provider sent, so it is read back rather than re-derived.
 */
interface ConversationKey {
  clientRecordId: string;
  phoneNormalized: string;
  existed: boolean;
}

export type ReplyPayload =
  | { kind: 'text'; text: string }
  | { kind: 'template'; templateName: string; languageCode: string };

export interface ReplyInput {
  leadId: string;
  /**
   * Caller-generated stable key. The mobile client reuses it when retrying a
   * queued reply after losing signal, so a retry can never double-send.
   */
  requestKey: string;
  payload: ReplyPayload;
}

export class DashboardLeadActionService {
  constructor(
    private readonly leads = new DashboardLeadListService(),
    private readonly audit = new AuditRepository(),
    private readonly sla = new SlaService(),
    private readonly followups = new FollowupSchedulerService(),
    private readonly messages = new MessageRequestService(),
  ) {}

  /**
   * Acknowledges the active assignment and cancels the pending SLA reminder and
   * escalation in the same transaction, so the worker can never fire a reminder
   * for an assignment that was already acknowledged.
   */
  async acknowledge(user: DashboardUser, scope: DashboardScope, leadId: string): Promise<{
    leadAssignmentId: string;
    acknowledgedAt: string;
    slaJobsCancelled: number;
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lead = await this.lockLead(client, scope, leadId);
      const assignment = await client.query<{
        lead_assignment_id: string;
        salesperson_id: string;
        acknowledged_at: Date | null;
      }>(
        `SELECT lead_assignment_id, salesperson_id, acknowledged_at
         FROM app.lead_assignments
         WHERE lead_id = $1 AND status = 'assigned'
         ORDER BY assigned_at DESC
         LIMIT 1
         FOR UPDATE`,
        [lead.lead_id],
      );
      const row = assignment.rows[0];
      if (!row) throw conflict('lead_has_no_active_assignment');
      if (user.role === 'salesperson' && row.salesperson_id !== user.salespersonId) {
        throw forbidden('assignment_belongs_to_another_salesperson');
      }
      if (row.acknowledged_at) {
        await client.query('COMMIT');
        return {
          leadAssignmentId: row.lead_assignment_id,
          acknowledgedAt: row.acknowledged_at.toISOString(),
          slaJobsCancelled: 0,
        };
      }

      const updated = await client.query<{ acknowledged_at: Date }>(
        `UPDATE app.lead_assignments
         SET acknowledged_at = now()
         WHERE lead_assignment_id = $1 AND acknowledged_at IS NULL
         RETURNING acknowledged_at`,
        [row.lead_assignment_id],
      );
      const acknowledgedAt = updated.rows[0]?.acknowledged_at;
      if (!acknowledgedAt) throw conflict('assignment_acknowledge_conflict');

      const slaJobsCancelled = await this.sla.cancelForAssignment(client, {
        leadAssignmentId: row.lead_assignment_id,
        reason: 'assignment_acknowledged_by_dashboard',
        actorId: user.userId,
        causationId: row.lead_assignment_id,
      });

      await this.audit.record(client, {
        eventType: 'dashboard.assignment_acknowledged',
        actorType: 'salesperson',
        actorId: user.userId,
        aggregateType: 'lead',
        aggregateId: lead.lead_id,
        causationId: row.lead_assignment_id,
        payload: {
          leadAssignmentId: row.lead_assignment_id,
          salespersonId: row.salesperson_id,
          slaJobsCancelled,
          clientId: lead.client_id,
        },
        after: { acknowledgedAt: acknowledgedAt.toISOString() },
      });
      await client.query('COMMIT');
      return {
        leadAssignmentId: row.lead_assignment_id,
        acknowledgedAt: acknowledgedAt.toISOString(),
        slaJobsCancelled,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async takeover(user: DashboardUser, scope: DashboardScope, leadId: string, enabled: boolean): Promise<{
    humanTakeover: boolean;
    appliedBeforeConversationExists: boolean;
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lead = await this.lockLead(client, scope, leadId);
      const key = await this.conversationKey(client, lead);

      // edge_lead_controls is the overlay the conversation engine consults
      // before replying, so it is the authority for suppression.
      await client.query(
        `INSERT INTO edge_lead_controls
          (client_record_id, phone_normalized, human_takeover, current_stage, source, source_event_id, control_version)
         VALUES ($1, $2, $3, $4, 'dashboard', $5, 1)
         ON CONFLICT (client_record_id, phone_normalized) DO UPDATE SET
           human_takeover = EXCLUDED.human_takeover,
           current_stage = CASE WHEN EXCLUDED.human_takeover THEN 'human_takeover' ELSE edge_lead_controls.current_stage END,
           source = 'dashboard',
           source_event_id = EXCLUDED.source_event_id,
           control_version = edge_lead_controls.control_version + 1,
           updated_at = now()`,
        [key.clientRecordId, key.phoneNormalized, enabled, enabled ? 'human_takeover' : '', `dashboard:${user.userId}`],
      );
      await client.query(
        `UPDATE edge_conversations
         SET human_takeover = $3,
             current_stage = CASE WHEN $3 THEN 'human_takeover' ELSE current_stage END,
             state_version = state_version + 1,
             updated_at = now()
         WHERE client_record_id = $1 AND phone_normalized = $2`,
        [key.clientRecordId, key.phoneNormalized, enabled],
      );
      await client.query(
        `UPDATE app.conversations
         SET human_takeover = $2, updated_at = now()
         WHERE lead_id = $1`,
        [lead.lead_id, enabled],
      );
      if (enabled) {
        await this.followups.cancelForLead(client, {
          leadId: lead.lead_id,
          reason: 'human_takeover_from_dashboard',
          actorId: user.userId,
        });
      }
      await this.audit.record(client, {
        eventType: enabled ? 'dashboard.human_takeover_enabled' : 'dashboard.human_takeover_disabled',
        actorType: 'operator',
        actorId: user.userId,
        aggregateType: 'lead',
        aggregateId: lead.lead_id,
        payload: { clientId: lead.client_id, humanTakeover: enabled },
      });
      await client.query('COMMIT');
      return { humanTakeover: enabled, appliedBeforeConversationExists: !key.existed };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(user: DashboardUser, scope: DashboardScope, leadId: string, reason: string): Promise<{
    status: string;
    closedStatus: string;
    followupsCancelled: number;
    slaJobsCancelled: number;
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lead = await this.lockLead(client, scope, leadId);
      await client.query(
        `UPDATE app.leads
         SET status = 'closed', closed_status = $2, updated_at = now()
         WHERE lead_id = $1`,
        [lead.lead_id, reason],
      );
      // A closed lead must not keep a scheduled nudge queued behind it.
      const followupsCancelled = await this.followups.cancelForLead(client, {
        leadId: lead.lead_id,
        reason: `lead_closed:${reason}`,
        actorId: user.userId,
      });
      const slaJobsCancelled = await this.sla.cancelForLead(client, {
        leadId: lead.lead_id,
        reason: `lead_closed:${reason}`,
        actorId: user.userId,
      });
      await this.audit.record(client, {
        eventType: 'dashboard.lead_closed',
        actorType: 'operator',
        actorId: user.userId,
        aggregateType: 'lead',
        aggregateId: lead.lead_id,
        payload: { clientId: lead.client_id, reason, followupsCancelled, slaJobsCancelled },
        before: { status: lead.status, closedStatus: lead.closed_status },
        after: { status: 'closed', closedStatus: reason },
      });
      await client.query('COMMIT');
      return { status: 'closed', closedStatus: reason, followupsCancelled, slaJobsCancelled };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async stopFollowUp(user: DashboardUser, scope: DashboardScope, leadId: string, reason: string): Promise<{
    stopFollowUp: boolean;
    followupsCancelled: number;
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lead = await this.lockLead(client, scope, leadId);
      await client.query(
        `UPDATE app.leads
         SET stop_follow_up = true, stop_reason = $2, updated_at = now()
         WHERE lead_id = $1`,
        [lead.lead_id, reason],
      );
      const key = await this.conversationKey(client, lead);
      await client.query(
        `INSERT INTO edge_lead_controls
          (client_record_id, phone_normalized, stop_follow_up, source, source_event_id, control_version)
         VALUES ($1, $2, true, 'dashboard', $3, 1)
         ON CONFLICT (client_record_id, phone_normalized) DO UPDATE SET
           stop_follow_up = true,
           source = 'dashboard',
           source_event_id = EXCLUDED.source_event_id,
           control_version = edge_lead_controls.control_version + 1,
           updated_at = now()`,
        [key.clientRecordId, key.phoneNormalized, `dashboard:${user.userId}`],
      );
      await client.query(
        `UPDATE edge_conversations
         SET stop_follow_up = true, state_version = state_version + 1, updated_at = now()
         WHERE client_record_id = $1 AND phone_normalized = $2`,
        [key.clientRecordId, key.phoneNormalized],
      );
      const followupsCancelled = await this.followups.cancelForLead(client, {
        leadId: lead.lead_id,
        reason: `stop_follow_up:${reason}`,
        actorId: user.userId,
      });
      await this.audit.record(client, {
        eventType: 'dashboard.followups_stopped',
        actorType: 'operator',
        actorId: user.userId,
        aggregateType: 'lead',
        aggregateId: lead.lead_id,
        payload: { clientId: lead.client_id, reason, followupsCancelled },
        after: { stopFollowUp: true, stopReason: reason },
      });
      await client.query('COMMIT');
      return { stopFollowUp: true, followupsCancelled };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Moves the lead along the sales pipeline.
   *
   * `app.leads.status` is deliberately untouched: it is the conversation
   * engine's own lifecycle and several services branch on it, so the pipeline
   * is recorded alongside rather than folded into it.
   */
  async setPipelineStage(user: DashboardUser, scope: DashboardScope, leadId: string, stage: string): Promise<{
    pipelineStage: string;
    previousPipelineStage: string;
    changed: boolean;
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lead = await this.lockLead(client, scope, leadId);
      if (lead.pipeline_stage === stage) {
        await client.query('COMMIT');
        return { pipelineStage: stage, previousPipelineStage: stage, changed: false };
      }

      const updated = await client.query<{ pipeline_stage: string }>(
        `UPDATE app.leads
         SET pipeline_stage = $2, updated_at = now()
         WHERE lead_id = $1
         RETURNING pipeline_stage`,
        [lead.lead_id, stage],
      );
      const pipelineStage = updated.rows[0]?.pipeline_stage;
      if (!pipelineStage) throw notFound('lead_not_found');

      await this.audit.record(client, {
        eventType: 'dashboard.pipeline_stage_changed',
        actorType: 'salesperson',
        actorId: user.userId,
        aggregateType: 'lead',
        aggregateId: lead.lead_id,
        payload: { clientId: lead.client_id, from: lead.pipeline_stage, to: pipelineStage },
        before: { pipelineStage: lead.pipeline_stage },
        after: { pipelineStage },
      });
      await client.query('COMMIT');
      return { pipelineStage, previousPipelineStage: lead.pipeline_stage, changed: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Queues an outbound WhatsApp message. Nothing is sent here: the shared
   * MessageRequestService writes the message row and the outbox command in one
   * transaction, and the messaging worker performs the HTTP call afterwards.
   */
  async reply(user: DashboardUser, scope: DashboardScope, input: ReplyInput): Promise<{
    messageId: string;
    outboxCommandId: string;
    sessionWindowOpen: boolean;
  }> {
    const visible = await this.leads.findVisibleLead(scope, input.leadId);
    if (!visible) throw notFound('lead_not_found');
    const record = await this.loadLeadRecord(scope, input.leadId);
    if (!record) throw notFound('lead_not_found');

    const windowExpiresAt = this.sessionWindowExpiry(record, visible);
    const sessionWindowOpen = Boolean(windowExpiresAt && Date.parse(windowExpiresAt) > Date.now());

    if (input.payload.kind === 'text') {
      if (!input.payload.text.trim()) throw badRequest('reply_text_required');
      // Outside the 24-hour session window Meta only accepts approved
      // templates, so free-form text is refused here rather than failing later
      // in the dispatcher.
      if (!sessionWindowOpen) {
        throw conflict('session_window_closed', {
          sessionWindowExpiresAt: windowExpiresAt,
          allowedMessageKind: 'template',
        });
      }
    }

    try {
      const result = await this.messages.requestWhatsAppSend({
        clientId: record.client_id,
        contactId: record.contact_id,
        leadId: record.lead_id,
        ...(record.conversation_id ? { conversationId: record.conversation_id } : {}),
        requestKey: `dashboard:${user.userId}:${input.requestKey}`,
        phoneNumberId: '',
        toE164: record.contact_phone,
        actorId: user.userId,
        ...(windowExpiresAt ? { conversationWindowExpiresAt: windowExpiresAt } : {}),
        payload:
          input.payload.kind === 'text'
            ? { kind: 'text', text: input.payload.text.trim() }
            : {
                kind: 'template',
                templateName: input.payload.templateName,
                languageCode: input.payload.languageCode,
                components: [],
              },
      });

      return {
        messageId: result.messageId,
        outboxCommandId: result.outboxCommandId,
        sessionWindowOpen,
      };
    } catch (error) {
      throw this.translateSendPolicyError(error, windowExpiresAt);
    }
  }

  /**
   * MessageRequestService is the fail-closed authority on send policy and
   * signals refusals with plain Errors. Those are expected outcomes of a caller
   * request, not server faults, so they are mapped to 4xx here.
   *
   * This also closes a time-of-check/time-of-use race: the window is evaluated
   * once above and again inside the service, and a reply sent close to the
   * 24-hour boundary can cross it in between. Without this translation that
   * race surfaced as an opaque 500 that reproduced only under load.
   */
  private translateSendPolicyError(error: unknown, windowExpiresAt: string | null): unknown {
    if (!(error instanceof Error)) return error;

    if (
      error.message === 'conversation_window_expired'
      || error.message === 'conversation_window_required_for_session_message'
    ) {
      return conflict('session_window_closed', {
        sessionWindowExpiresAt: windowExpiresAt,
        allowedMessageKind: 'template',
      });
    }

    if (error.message.startsWith('whatsapp_template_not_approved:')) {
      return badRequest('template_not_approved', {
        templateName: error.message.slice('whatsapp_template_not_approved:'.length),
      });
    }

    return error;
  }

  private sessionWindowExpiry(record: LeadRecord, visible: LeadListItem): string | null {
    if (record.conversation_window_expires_at) return record.conversation_window_expires_at.toISOString();
    const lastInbound = visible.lastInboundAt || (record.last_inbound_at?.toISOString() ?? null);
    if (!lastInbound) return null;
    return new Date(Date.parse(lastInbound) + SESSION_WINDOW_MS).toISOString();
  }

  private async loadLeadRecord(scope: DashboardScope, leadId: string): Promise<LeadRecord | null> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const leadParam = params.bind(leadId);
    const result = await pool.query<LeadRecord>(
      `SELECT l.lead_id, l.client_id, l.contact_id, l.status, l.pipeline_stage, l.stop_follow_up, l.closed_status,
              ct.phone_e164 AS contact_phone,
              COALESCE(cl.legacy_airtable_id, cl.client_key) AS client_record_id,
              conv.conversation_id, conv.last_inbound_at, conv.conversation_window_expires_at
       FROM app.leads l
       JOIN app.contacts ct ON ct.contact_id = l.contact_id
       JOIN app.clients cl ON cl.client_id = l.client_id
       LEFT JOIN LATERAL (
         SELECT c.conversation_id, c.last_inbound_at, c.conversation_window_expires_at
         FROM app.conversations c
         WHERE c.lead_id = l.lead_id
         ORDER BY c.opened_at DESC
         LIMIT 1
       ) conv ON true
       WHERE (${visibility}) AND l.lead_id = ${leadParam}::uuid`,
      params.list(),
    );
    return result.rows[0] ?? null;
  }

  private async lockLead(client: PoolClient, scope: DashboardScope, leadId: string): Promise<LeadRecord> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const leadParam = params.bind(leadId);
    const result = await client.query<LeadRecord>(
      `SELECT l.lead_id, l.client_id, l.contact_id, l.status, l.pipeline_stage, l.stop_follow_up, l.closed_status,
              ct.phone_e164 AS contact_phone,
              COALESCE(cl.legacy_airtable_id, cl.client_key) AS client_record_id,
              NULL::uuid AS conversation_id,
              NULL::timestamptz AS last_inbound_at,
              NULL::timestamptz AS conversation_window_expires_at
       FROM app.leads l
       JOIN app.contacts ct ON ct.contact_id = l.contact_id
       JOIN app.clients cl ON cl.client_id = l.client_id
       WHERE (${visibility}) AND l.lead_id = ${leadParam}::uuid
       FOR UPDATE OF l`,
      params.list(),
    );
    const row = result.rows[0];
    if (!row) throw notFound('lead_not_found');
    return row;
  }

  private async conversationKey(client: PoolClient, lead: LeadRecord): Promise<ConversationKey> {
    const digits = lead.contact_phone.replace(/\D/g, '');
    const variants = [lead.contact_phone, digits, `+${digits}`];
    const existing = await client.query<{ client_record_id: string; phone_normalized: string }>(
      `SELECT client_record_id, phone_normalized
       FROM edge_conversations
       WHERE lead_id = $1
          OR (client_id = $2 AND phone_normalized = ANY($3::text[]))
       ORDER BY (lead_id = $1) DESC, updated_at DESC
       LIMIT 1`,
      [lead.lead_id, lead.client_id, variants],
    );
    const row = existing.rows[0];
    if (row) {
      return { clientRecordId: row.client_record_id, phoneNormalized: row.phone_normalized, existed: true };
    }
    // No conversation yet: pre-seed the control so the first inbound message
    // inherits the operator's decision instead of being auto-answered.
    return { clientRecordId: lead.client_record_id, phoneNormalized: lead.contact_phone, existed: false };
  }
}
