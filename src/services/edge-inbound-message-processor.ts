import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { ConfigRepository } from '../repositories/config-repository.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { evaluateConversation } from '../domain/engine.js';
import type { ConversationState, ReplyDecision } from '../domain/types.js';
import { pool } from '../db/pool.js';
import {
  AuditRepository,
  RuntimeOutboxRepository,
  sha256Hex,
  stableJson,
  type ClaimedInboxEvent,
} from '../infrastructure/runtime.js';
import type { InboxProcessingResult } from '../worker/runtime-worker.js';
import type { MessagingPayload } from '../integrations/messaging/types.js';
import { LeadScoringService } from './lead-scoring-service.js';

const inboundMessageSchema = z.object({
  webhookType: z.literal('whatsapp.message_received'),
  phoneNumberId: z.string().min(1),
  metaMessageId: z.string().min(1),
  from: z.string().min(5),
  messageType: z.string().min(1),
  messageText: z.string().optional().default(''),
  messageOptionId: z.string().optional().default(''),
  receivedAt: z.string().datetime().nullable().optional(),
  profileName: z.string().optional().default(''),
  rawMessage: z.record(z.unknown()).optional().default({}),
});

type InboundMessagePayload = z.infer<typeof inboundMessageSchema>;

function toMessagingPayload(decision: ReplyDecision): MessagingPayload {
  if (decision.messageKind === 'buttons') {
    return {
      kind: 'buttons',
      text: decision.text,
      options: (decision.interactiveOptions || []).slice(0, 3).map((option) => ({
        id: option.id,
        title: option.label,
      })),
    };
  }
  if (decision.messageKind === 'list') {
    return {
      kind: 'list',
      text: decision.text,
      buttonText: 'Choose',
      options: (decision.interactiveOptions || []).slice(0, 10).map((option) => ({
        id: option.id,
        title: option.label,
      })),
    };
  }
  return { kind: 'text', text: decision.text };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'الغاء', 'إلغاء', 'وقف', 'بلوك', 'مش مهتم', 'مش عايز'];

function isOptOut(text: string): boolean {
  const value = text.toLocaleLowerCase().trim();
  return OPT_OUT_WORDS.some((word) => value.includes(word.toLocaleLowerCase()));
}

function optOutDecision(state: ConversationState): ReplyDecision {
  const nextState: ConversationState = {
    ...state,
    status: 'not_interested',
    currentStage: 'stopped',
    currentQuestionKey: '',
    stopFollowUp: true,
    stateVersion: state.stateVersion + 1,
  };
  return {
    action: 'no_reply',
    replyKey: 'opt_out_recorded',
    text: '',
    messageKind: 'text',
    stageBefore: state.currentStage,
    stageAfter: 'stopped',
    suppressionReason: 'lead_opted_out',
    outboxEvents: [{ eventType: 'lead_opted_out', payload: { reason: 'lead_opted_out' } }],
    nextState,
  };
}

export class EdgeInboundMessageProcessor {
  constructor(
    private readonly configs = new ConfigRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
    private readonly scorer = new LeadScoringService(),
  ) {}

  async process(event: ClaimedInboxEvent): Promise<InboxProcessingResult> {
    if (!['meta', 'n8n'].includes(event.provider) || event.eventType !== 'whatsapp.message_received') {
      return { outcome: 'ignored', reason: `unsupported_inbox_event:${event.provider}:${event.eventType}` };
    }
    const parsed = inboundMessageSchema.safeParse(event.payload);
    if (!parsed.success) {
      return { outcome: 'dead_lettered', reason: `invalid_whatsapp_message_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }
    const input = parsed.data;
    const started = performance.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const channel = await client.query<{ client_record_id: string; active: boolean; direct_send_enabled: boolean }>(
        `SELECT client_record_id, active, direct_send_enabled
         FROM edge_client_channels
         WHERE phone_number_id=$1
         LIMIT 1`,
        [input.phoneNumberId],
      );
      const channelRow = channel.rows[0];
      if (!channelRow || !channelRow.active || !channelRow.direct_send_enabled) {
        await client.query('ROLLBACK');
        return { outcome: 'ignored', reason: 'channel_not_edge_enabled' };
      }

      await this.conversations.lockScope(client, channelRow.client_record_id, input.from);
      const state = await this.conversations.find(client, channelRow.client_record_id, input.from);
      if (!state || !state.conversationId) {
        await client.query('ROLLBACK');
        return { outcome: 'ignored', reason: 'conversation_not_activated' };
      }
      if (state.conversationEngine !== 'edge' || state.stateAuthority !== 'edge') {
        await client.query('ROLLBACK');
        return { outcome: 'ignored', reason: 'conversation_owned_by_legacy' };
      }

      const duplicate = await client.query<{ status: string }>(
        'SELECT status FROM edge_active_turns WHERE client_record_id=$1 AND meta_message_id=$2 LIMIT 1',
        [state.clientRecordId, input.metaMessageId],
      );
      if (duplicate.rows[0]) {
        await client.query('COMMIT');
        return { outcome: 'processed' };
      }

      await client.query(
        `INSERT INTO edge_active_turns
          (conversation_id, client_record_id, meta_message_id, inbound_event_id, status)
         VALUES ($1, $2, $3, $4, 'processing')`,
        [state.conversationId, state.clientRecordId, input.metaMessageId, event.inboxEventId],
      );

      const receivedAt = input.receivedAt || new Date().toISOString();
      state.lastInboundAt = receivedAt;
      state.conversationWindowExpiresAt = new Date(new Date(receivedAt).getTime() + 24 * 3600 * 1000).toISOString();
      state.leadName = state.leadName || input.profileName || '';

      const config = await this.configs.getByVersion(state.configVersion, client);
      const decision = isOptOut(input.messageText)
        ? optOutDecision(state)
        : evaluateConversation({
            state,
            config,
            ...(input.messageText ? { messageText: input.messageText } : {}),
            ...(input.messageOptionId ? { messageOptionId: input.messageOptionId } : {}),
          });

      if (decision.action === 'fallback') {
        await client.query(
          `UPDATE edge_active_turns
           SET status='fallback', decision_json=$3::jsonb, duration_ms=$4, updated_at=now()
           WHERE client_record_id=$1 AND meta_message_id=$2`,
          [state.clientRecordId, input.metaMessageId, JSON.stringify(decision), Number((performance.now() - started).toFixed(3))],
        );
        await client.query('COMMIT');
        return { outcome: 'ignored', reason: 'typebot_fallback_required' };
      }

      decision.nextState.conversationId = state.conversationId;
      decision.nextState.configVersion = state.configVersion;
      decision.nextState.configurationVersionId = state.configurationVersionId;
      await this.conversations.update(client, decision.nextState);
      await client.query(
        `INSERT INTO edge_message_events (
          conversation_id, client_record_id, direction, external_event_id, meta_message_id,
          message_type, message_text, option_id, raw_payload
        ) VALUES ($1,$2,'inbound',$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT (client_record_id, meta_message_id) WHERE meta_message_id <> '' DO NOTHING`,
        [
          state.conversationId,
          state.clientRecordId,
          event.inboxEventId,
          input.metaMessageId,
          input.messageType,
          input.messageText,
          input.messageOptionId,
          JSON.stringify(input.rawMessage),
        ],
      );

      const target = await this.resolveAppLead(client, state.leadId);
      const appConversationId = target
        ? await this.upsertAppConversation(client, decision.nextState, target)
        : '';
      if (target && appConversationId) {
        await this.persistInboundAppMessage(client, {
          appConversationId,
          target,
          input,
          event,
        });
      }

      await this.persistQualificationEvents(client, state.leadId, decision, appConversationId, {
        correlationId: event.dedupeKey,
        causationId: event.inboxEventId,
      });
      if (decision.outboxEvents.some((outboxEvent) => outboxEvent.eventType === 'lead_opted_out')) {
        await this.persistOptOut(client, decision.nextState, input.from);
      }
      if (decision.suppressionReason === 'human_takeover') {
        await this.persistControlSnapshot(client, decision.nextState, event.inboxEventId);
      }

      let messageId = '';
      let outboxCommandId = '';
      if (decision.action !== 'no_reply' && decision.text) {
        if (!target) {
          await client.query('ROLLBACK');
          return { outcome: 'ignored', reason: 'app_lead_not_found_for_edge_conversation' };
        }
        const payload = toMessagingPayload(decision);
        const idempotencyKey = `whatsapp.send:${target.clientId}:inbox:${event.inboxEventId}:${sha256Hex(stableJson(payload)).slice(0, 24)}`;
        const message = await client.query<{ message_id: string }>(
          `INSERT INTO app.messages
            (conversation_id, lead_id, client_id, contact_id, direction, channel, to_address,
             message_text, message_type, state, raw_payload, idempotency_key)
           VALUES ($1, $2, $3, $4, 'outbound', 'whatsapp', $5, $6, $7, 'queued', $8::jsonb, $9)
           ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key <> ''
           DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
           RETURNING message_id`,
          [
            appConversationId || null,
            target.leadId,
            target.clientId,
            target.contactId,
            input.from,
            decision.text,
            payload.kind,
            JSON.stringify({
              provider: 'meta',
              phoneNumberId: input.phoneNumberId,
              toE164: input.from,
              message: payload,
              idempotencyKey,
              source: 'edge_inbound_message',
            }),
            idempotencyKey,
          ],
        );
        messageId = message.rows[0]?.message_id || '';
        if (!messageId) throw new Error('edge_reply_message_not_created');
        outboxCommandId = await this.outbox.enqueue(client, {
          commandType: 'whatsapp.send_message',
          destination: input.from,
          idempotencyKey,
          aggregateKey: target.leadId,
          payload: {
            provider: 'meta',
            phoneNumberId: input.phoneNumberId,
            toE164: input.from,
            message: payload,
            messageId,
            leadId: target.leadId,
          },
        });
      }

      await this.audit.record(client, {
        eventType: 'conversation.inbound_processed',
        actorType: 'external_user',
        actorId: input.from,
        aggregateType: 'lead',
        ...(isUuid(state.leadId) ? { aggregateId: state.leadId } : {}),
        correlationId: event.dedupeKey,
        causationId: event.inboxEventId,
        payload: {
          provider: event.provider,
          stageBefore: decision.stageBefore,
          stageAfter: decision.stageAfter,
          action: decision.action,
          replyQueued: Boolean(outboxCommandId),
        },
        after: {
          currentStage: decision.nextState.currentStage,
          currentQuestionKey: decision.nextState.currentQuestionKey,
        },
      });
      if (decision.suppressionReason) {
        await this.audit.record(client, {
          eventType: 'conversation.reply_suppressed',
          actorType: decision.suppressionReason === 'lead_opted_out' ? 'external_user' : 'system',
          actorId: decision.suppressionReason === 'lead_opted_out' ? input.from : 'edge-inbound-message-processor',
          aggregateType: 'lead',
          ...(isUuid(state.leadId) ? { aggregateId: state.leadId } : {}),
          correlationId: event.dedupeKey,
          causationId: event.inboxEventId,
          payload: {
            provider: event.provider,
            reason: decision.suppressionReason,
            replyQueued: false,
          },
          before: {
            currentStage: decision.stageBefore,
            stopFollowUp: state.stopFollowUp,
            humanTakeover: state.humanTakeover,
          },
          after: {
            currentStage: decision.nextState.currentStage,
            stopFollowUp: decision.nextState.stopFollowUp,
            humanTakeover: decision.nextState.humanTakeover,
          },
        });
      }

      await client.query(
        `UPDATE edge_active_turns
         SET status=$3, decision_json=$4::jsonb, duration_ms=$5, send_response_json=$6::jsonb, updated_at=now()
         WHERE client_record_id=$1 AND meta_message_id=$2`,
        [
          state.clientRecordId,
          input.metaMessageId,
          outboxCommandId ? 'queued' : 'suppressed',
          JSON.stringify(decision),
          Number((performance.now() - started).toFixed(3)),
          JSON.stringify({ messageId, outboxCommandId }),
        ],
      );
      await client.query('COMMIT');
      return { outcome: 'processed' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolveAppLead(client: typeof pool | import('pg').PoolClient, leadId: string): Promise<{
    leadId: string;
    clientId: string;
    contactId: string;
  } | null> {
    if (!isUuid(leadId)) return null;
    const result = await client.query<{ lead_id: string; client_id: string; contact_id: string }>(
      'SELECT lead_id, client_id, contact_id FROM app.leads WHERE lead_id=$1',
      [leadId],
    );
    const row = result.rows[0];
    return row ? { leadId: row.lead_id, clientId: row.client_id, contactId: row.contact_id } : null;
  }

  private async upsertAppConversation(
    client: typeof pool | import('pg').PoolClient,
    state: ConversationState,
    target: { leadId: string; clientId: string; contactId: string },
  ): Promise<string> {
    const result = await client.query<{ conversation_id: string }>(
      `INSERT INTO app.conversations
        (client_id, contact_id, lead_id, configuration_version_id, status,
         current_stage, current_question_key, preferred_language, human_takeover,
         state_json, state_version, last_inbound_at, conversation_window_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,NULLIF($12,'')::timestamptz,NULLIF($13,'')::timestamptz)
       ON CONFLICT (lead_id) WHERE lead_id IS NOT NULL DO UPDATE SET
         client_id=EXCLUDED.client_id,
         contact_id=EXCLUDED.contact_id,
         configuration_version_id=EXCLUDED.configuration_version_id,
         status=EXCLUDED.status,
         current_stage=EXCLUDED.current_stage,
         current_question_key=EXCLUDED.current_question_key,
         preferred_language=EXCLUDED.preferred_language,
         human_takeover=EXCLUDED.human_takeover,
         state_json=EXCLUDED.state_json,
         state_version=EXCLUDED.state_version,
         last_inbound_at=EXCLUDED.last_inbound_at,
         conversation_window_expires_at=EXCLUDED.conversation_window_expires_at,
         closed_at=CASE
           WHEN EXCLUDED.status IN ('qualified','not_interested','stopped') THEN COALESCE(app.conversations.closed_at, now())
           ELSE app.conversations.closed_at
         END,
         updated_at=now()
       RETURNING conversation_id`,
      [
        target.clientId,
        target.contactId,
        target.leadId,
        state.configurationVersionId ?? null,
        state.status || 'open',
        state.currentStage,
        state.currentQuestionKey,
        state.preferredLanguage,
        state.humanTakeover,
        JSON.stringify({
          source: 'edge_conversations',
          edgeConversationId: state.conversationId,
          clientRecordId: state.clientRecordId,
          leadRecordId: state.leadRecordId,
          answers: state.answers,
          stopFollowUp: state.stopFollowUp,
          stateAuthority: state.stateAuthority,
          conversationEngine: state.conversationEngine,
        }),
        state.stateVersion,
        state.lastInboundAt,
        state.conversationWindowExpiresAt,
      ],
    );
    const appConversationId = result.rows[0]?.conversation_id;
    if (!appConversationId) throw new Error('app_conversation_projection_not_created');
    return appConversationId;
  }

  private async persistInboundAppMessage(
    client: typeof pool | import('pg').PoolClient,
    input: {
      appConversationId: string;
      target: { leadId: string; clientId: string; contactId: string };
      input: InboundMessagePayload;
      event: ClaimedInboxEvent;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.messages
        (conversation_id, lead_id, client_id, contact_id, direction, channel,
         from_address, message_text, message_type, provider_message_id, state, raw_payload)
       VALUES ($1,$2,$3,$4,'inbound','whatsapp',$5,$6,$7,$8,'delivered',$9::jsonb)
       ON CONFLICT (client_id, provider_message_id) WHERE provider_message_id <> ''
       DO UPDATE SET conversation_id=EXCLUDED.conversation_id
       RETURNING message_id`,
      [
        input.appConversationId,
        input.target.leadId,
        input.target.clientId,
        input.target.contactId,
        input.input.from,
        input.input.messageText,
        input.input.messageType,
        input.input.metaMessageId,
        JSON.stringify({
          provider: input.event.provider,
          inboxEventId: input.event.inboxEventId,
          phoneNumberId: input.input.phoneNumberId,
          messageOptionId: input.input.messageOptionId,
          rawMessage: input.input.rawMessage,
        }),
      ],
    );
  }

  private async persistQualificationEvents(
    client: typeof pool | import('pg').PoolClient,
    leadId: string,
    decision: ReplyDecision,
    appConversationId: string,
    scoringContext: { correlationId: string; causationId: string },
  ): Promise<void> {
    if (!isUuid(leadId)) return;
    const answerEvents = decision.outboxEvents.filter((event) => event.eventType === 'qualification_answer_saved');
    if (answerEvents.length === 0 && !decision.outboxEvents.some((event) => event.eventType === 'qualification_completed')) return;
    const session = await client.query<{ qualification_session_id: string }>(
      `WITH existing AS (
        SELECT qualification_session_id
        FROM app.qualification_sessions
        WHERE lead_id=$1 AND status='in_progress'
        ORDER BY started_at DESC
        LIMIT 1
      ), inserted AS (
        INSERT INTO app.qualification_sessions (conversation_id, lead_id, status, configuration_version_id)
        SELECT NULLIF($3, '')::uuid, $1, 'in_progress', $2
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING qualification_session_id
      )
      SELECT qualification_session_id FROM inserted
      UNION ALL
      SELECT qualification_session_id FROM existing
      LIMIT 1`,
      [leadId, decision.nextState.configurationVersionId ?? null, appConversationId],
    );
    const sessionId = session.rows[0]?.qualification_session_id;
    if (!sessionId) throw new Error('qualification_session_not_created');
    for (const event of answerEvents) {
      const payload = event.payload as {
        questionKey?: unknown;
        parsedValue?: unknown;
        raw?: unknown;
        parseSource?: unknown;
      };
      const questionKey = String(payload.questionKey || '');
      if (!questionKey) continue;
      await client.query(
        `INSERT INTO app.qualification_answers
          (qualification_session_id, question_key, normalized_value, raw_value, parser_source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (qualification_session_id, question_key)
         DO UPDATE SET normalized_value=EXCLUDED.normalized_value,
                       raw_value=EXCLUDED.raw_value,
                       parser_source=EXCLUDED.parser_source`,
        [
          sessionId,
          questionKey,
          String(payload.parsedValue || ''),
          String(payload.raw || ''),
          String(payload.parseSource || ''),
        ],
      );
    }
    if (decision.outboxEvents.some((event) => event.eventType === 'qualification_completed')) {
      await client.query(
        `UPDATE app.qualification_sessions
         SET status='completed',
             completed_at=now(),
             conversation_id=COALESCE(conversation_id, NULLIF($3, '')::uuid),
             configuration_version_id=COALESCE(configuration_version_id, $2)
         WHERE qualification_session_id=$1`,
        [sessionId, decision.nextState.configurationVersionId ?? null, appConversationId],
      );
      await client.query(
        `UPDATE app.leads
         SET status='qualified',
             current_stage='qualified',
             updated_at=now()
         WHERE lead_id=$1`,
        [leadId],
      );
      await this.scorer.scoreLead(client, {
        leadId,
        answers: decision.nextState.answers,
        actorType: 'worker',
        actorId: 'edge-inbound-message-processor',
        correlationId: scoringContext.correlationId,
        causationId: scoringContext.causationId,
      });
    }
  }

  private async persistOptOut(
    client: typeof pool | import('pg').PoolClient,
    state: ConversationState,
    phoneNormalized: string,
  ): Promise<void> {
    await this.persistControlSnapshot(client, state, 'lead_opted_out');
    if (!isUuid(state.leadId)) return;
    await client.query(
      `UPDATE app.leads
       SET status='not_interested',
           current_stage='stopped',
           stop_follow_up=true,
           stop_reason='lead_opted_out',
           updated_at=now()
       WHERE lead_id=$1`,
      [state.leadId],
    );
    await client.query(
      `UPDATE app.contacts c
       SET opted_out=true,
           opt_out_reason='lead_opted_out',
           updated_at=now()
       FROM app.leads l
       WHERE l.contact_id=c.contact_id
         AND l.lead_id=$1
         AND c.phone_e164=$2`,
      [state.leadId, phoneNormalized],
    );
  }

  private async persistControlSnapshot(
    client: typeof pool | import('pg').PoolClient,
    state: ConversationState,
    sourceEventId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_lead_controls (
        client_record_id, phone_normalized, lead_record_id, status, current_stage,
        human_takeover, stop_follow_up, closed_status, appointment_status,
        assigned_salesperson_record_id, assigned_salesperson_phone, source, source_event_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'edge_inbound_message',$12)
      ON CONFLICT (client_record_id, phone_normalized) DO UPDATE SET
        lead_record_id=COALESCE(NULLIF(EXCLUDED.lead_record_id,''), edge_lead_controls.lead_record_id),
        status=COALESCE(NULLIF(EXCLUDED.status,''), edge_lead_controls.status),
        current_stage=COALESCE(NULLIF(EXCLUDED.current_stage,''), edge_lead_controls.current_stage),
        human_takeover=EXCLUDED.human_takeover,
        stop_follow_up=EXCLUDED.stop_follow_up,
        closed_status=COALESCE(NULLIF(EXCLUDED.closed_status,''), edge_lead_controls.closed_status),
        appointment_status=COALESCE(NULLIF(EXCLUDED.appointment_status,''), edge_lead_controls.appointment_status),
        assigned_salesperson_record_id=COALESCE(NULLIF(EXCLUDED.assigned_salesperson_record_id,''), edge_lead_controls.assigned_salesperson_record_id),
        assigned_salesperson_phone=COALESCE(NULLIF(EXCLUDED.assigned_salesperson_phone,''), edge_lead_controls.assigned_salesperson_phone),
        source='edge_inbound_message',
        source_event_id=EXCLUDED.source_event_id,
        control_version=edge_lead_controls.control_version + 1,
        updated_at=now()`,
      [
        state.clientRecordId,
        state.phoneNormalized,
        state.leadRecordId,
        state.status,
        state.currentStage,
        state.humanTakeover,
        state.stopFollowUp,
        state.closedStatus,
        state.appointmentStatus,
        state.assignedSalespersonRecordId,
        state.assignedSalespersonPhone,
        sourceEventId,
      ],
    );
  }
}
