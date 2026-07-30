import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction.js';
import { evaluateConversation } from '../domain/engine.js';
import type { ReplyDecision } from '../domain/types.js';
import { ConfigRepository } from '../repositories/config-repository.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { OutboxRepository } from '../repositories/outbox-repository.js';
import { MetaSender } from './meta-sender.js';

export interface ActiveTurnInput {
  eventId: string;
  metaMessageId: string;
  phoneNumberId: string;
  phoneNormalized: string;
  profileName?: string | undefined;
  messageType: string;
  messageText?: string | undefined;
  messageOptionId?: string | undefined;
  receivedAt?: string | undefined;
}

export interface ActiveTurnOutput {
  handled: boolean;
  duplicate: boolean;
  reason: string;
  durationMs: number;
  decision?: ReplyDecision;
  sent: boolean;
  providerMessageId: string;
  sendError: string;
}

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'الغاء', 'إلغاء', 'وقف', 'بلوك', 'مش مهتم', 'مش عايز'];

function isOptOut(text: string): boolean {
  const value = text.toLocaleLowerCase().trim();
  return OPT_OUT_WORDS.some((word) => value.includes(word.toLocaleLowerCase()));
}

function optOutDecision(state: any): ReplyDecision {
  const arabic = state.preferredLanguage !== 'English';
  const nextState = {
    ...state,
    status: 'not_interested',
    currentStage: 'stopped',
    currentQuestionKey: '',
    stopFollowUp: true,
    stateVersion: state.stateVersion + 1,
  };
  return {
    action: 'reply',
    replyKey: 'opt_out_confirmation',
    text: arabic
      ? 'تمام، مش هنبعت لحضرتك رسائل تانية. شكراً ليك.'
      : 'Understood. We will not send you any more messages. Thank you.',
    messageKind: 'text',
    stageBefore: state.currentStage,
    stageAfter: 'stopped',
    outboxEvents: [{ eventType: 'lead_opted_out', payload: { reason: 'lead_opted_out' } }],
    nextState,
  };
}

class DefiniteMetaSendFailure extends Error {
  constructor(public readonly result: { statusCode: number; error: string }) {
    super(`definite_meta_send_failure:${result.statusCode}:${result.error}`);
  }
}

export class ActiveTurnService {
  constructor(
    private readonly configs = new ConfigRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly outbox = new OutboxRepository(),
    private readonly sender = new MetaSender(),
  ) {}

  async handle(input: ActiveTurnInput): Promise<ActiveTurnOutput> {
    const started = performance.now();
    try {
      return await withTransaction(async (client) => this.handleInTransaction(client, input, started));
    } catch (error) {
      // A definite Meta rejection means no outbound message was accepted. Roll back the
      // Edge state transition and let the untouched Typebot/04 path answer instead.
      if (error instanceof DefiniteMetaSendFailure) {
        return this.notHandled(`meta_rejected_legacy_fallback:${error.result.statusCode}`, started);
      }
      throw error;
    }
  }

  private async handleInTransaction(
    client: PoolClient,
    input: ActiveTurnInput,
    started: number,
  ): Promise<ActiveTurnOutput> {
    if (!['text', 'button', 'interactive'].includes(input.messageType)) {
      return this.notHandled('unsupported_message_type', started);
    }

    const channelResult = await client.query<{
      client_record_id: string;
      active: boolean;
      direct_send_enabled: boolean;
    }>(
      `SELECT client_record_id,active,direct_send_enabled
       FROM edge_client_channels WHERE phone_number_id=$1`,
      [input.phoneNumberId],
    );
    const channel = channelResult.rows[0];
    if (!channel || !channel.active || !channel.direct_send_enabled) {
      return this.notHandled('channel_not_active', started);
    }

    await this.conversations.lockScope(client, channel.client_record_id, input.phoneNormalized);
    const state = await this.conversations.find(client, channel.client_record_id, input.phoneNormalized);
    if (!state) return this.notHandled('conversation_not_activated', started);
    if (state.conversationEngine !== 'edge' || state.stateAuthority !== 'edge') {
      return this.notHandled('conversation_owned_by_legacy', started);
    }
    if (!state.conversationId) throw new Error('Conversation ID missing');

    const prior = await client.query<any>(
      `SELECT status,decision_json,provider_message_id,send_response_json,duration_ms
       FROM edge_active_turns WHERE client_record_id=$1 AND meta_message_id=$2`,
      [state.clientRecordId, input.metaMessageId],
    );
    if (prior.rows[0]) {
      const row = prior.rows[0];
      return {
        handled: row.status !== 'fallback',
        duplicate: true,
        reason: `duplicate_${row.status}`,
        durationMs: Number(row.duration_ms || 0),
        decision: row.decision_json || undefined,
        sent: row.status === 'sent',
        providerMessageId: String(row.provider_message_id || ''),
        sendError: String(row.send_response_json?.error || ''),
      };
    }

    await client.query(
      `INSERT INTO edge_active_turns
       (conversation_id,client_record_id,meta_message_id,inbound_event_id,status)
       VALUES ($1,$2,$3,$4,'processing')`,
      [state.conversationId, state.clientRecordId, input.metaMessageId, input.eventId],
    );

    const receivedAt = input.receivedAt || new Date().toISOString();
    state.lastInboundAt = receivedAt;
    state.conversationWindowExpiresAt = new Date(new Date(receivedAt).getTime() + 24 * 3600 * 1000).toISOString();
    state.leadName = state.leadName || input.profileName || '';

    const config = await this.configs.getByVersion(state.configVersion, client);
    const decision = isOptOut(input.messageText || '')
      ? optOutDecision(state)
      : evaluateConversation({
          state,
          config,
          ...(input.messageText !== undefined ? { messageText: input.messageText } : {}),
          ...(input.messageOptionId !== undefined ? { messageOptionId: input.messageOptionId } : {}),
        });

    if (decision.action === 'fallback') {
      const durationMs = Number((performance.now() - started).toFixed(3));
      await client.query(
        `UPDATE edge_active_turns SET status='fallback',decision_json=$3::jsonb,duration_ms=$4,updated_at=now()
         WHERE client_record_id=$1 AND meta_message_id=$2`,
        [state.clientRecordId, input.metaMessageId, JSON.stringify(decision), durationMs],
      );
      return { handled: false, duplicate: false, reason: 'engine_fallback', durationMs, decision, sent: false, providerMessageId: '', sendError: '' };
    }

    decision.nextState.conversationId = state.conversationId;
    decision.nextState.configVersion = state.configVersion;
    await this.conversations.update(client, decision.nextState);

    await client.query(
      `INSERT INTO edge_message_events (
         conversation_id,client_record_id,direction,external_event_id,meta_message_id,
         message_type,message_text,option_id,raw_payload
       ) VALUES ($1,$2,'inbound',$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (client_record_id,meta_message_id) WHERE meta_message_id <> '' DO NOTHING`,
      [state.conversationId, state.clientRecordId, input.eventId, input.metaMessageId,
       input.messageType, input.messageText || '', input.messageOptionId || '', JSON.stringify(input)],
    );

    const basePayload = {
      leadRecordId: decision.nextState.leadRecordId,
      clientRecordId: decision.nextState.clientRecordId,
      phoneNormalized: decision.nextState.phoneNormalized,
      metaMessageId: input.metaMessageId,
      providerMessageId: input.metaMessageId,
      inboundEventId: input.eventId,
      configVersion: state.configVersion,
      stageBefore: decision.stageBefore,
      stageAfter: decision.stageAfter,
      stateVersion: decision.nextState.stateVersion,
    };
    const events: ReplyDecision['outboxEvents'] = [
      {
        eventType: 'inbound_message_received',
        payload: {
          messageText: input.messageText || '',
          messageOptionId: input.messageOptionId || '',
          messageType: input.messageType,
          receivedAt,
        },
      },
      ...decision.outboxEvents,
    ];
    if (decision.stageBefore !== decision.stageAfter) {
      events.push({ eventType: 'conversation_stage_changed', payload: { from: decision.stageBefore, to: decision.stageAfter } });
    }
    for (const [index, event] of events.entries()) {
      await this.outbox.enqueue(client, {
        conversationId: state.conversationId,
        eventType: event.eventType,
        idempotencyKey: `${state.clientRecordId}:${input.metaMessageId}:${event.eventType}:${index}`,
        payload: { ...basePayload, ...event.payload },
        parked: false,
      });
    }

    if (decision.action === 'no_reply' || !decision.text) {
      const durationMs = Number((performance.now() - started).toFixed(3));
      await client.query(
        `UPDATE edge_active_turns SET status='suppressed',decision_json=$3::jsonb,duration_ms=$4,updated_at=now()
         WHERE client_record_id=$1 AND meta_message_id=$2`,
        [state.clientRecordId, input.metaMessageId, JSON.stringify(decision), durationMs],
      );
      return { handled: true, duplicate: false, reason: decision.suppressionReason || 'no_reply', durationMs, decision, sent: false, providerMessageId: '', sendError: '' };
    }

    const send = await this.sender.send({ phoneNumberId: input.phoneNumberId, to: input.phoneNormalized, decision });
    if (!send.ok && send.statusCode !== 599) {
      throw new DefiniteMetaSendFailure({ statusCode: send.statusCode, error: send.error });
    }
    await client.query(
      `INSERT INTO edge_message_events (
         conversation_id,client_record_id,direction,external_event_id,provider_message_id,
         message_type,message_text,raw_payload,processing_status
       ) VALUES ($1,$2,'outbound',$3,$4,$5,$6,$7::jsonb,$8)`,
      [state.conversationId, state.clientRecordId, `edge-out:${input.metaMessageId}`,
       send.providerMessageId, decision.messageKind, decision.text,
       JSON.stringify({ decision, send }), send.ok ? 'accepted' : 'failed'],
    );
    await this.outbox.enqueue(client, {
      conversationId: state.conversationId,
      eventType: send.ok ? 'outbound_message_accepted' : 'outbound_message_failed',
      idempotencyKey: `${state.clientRecordId}:${input.metaMessageId}:outbound_result`,
      payload: {
        ...basePayload,
        text: decision.text,
        messageKind: decision.messageKind,
        interactiveOptions: decision.interactiveOptions || [],
        providerMessageId: send.providerMessageId,
        whatsappStatus: send.ok ? 'sent' : 'failed',
        sendError: send.error,
      },
      parked: false,
    });

    const durationMs = Number((performance.now() - started).toFixed(3));
    await client.query(
      `UPDATE edge_active_turns SET status=$3,decision_json=$4::jsonb,provider_message_id=$5,
       send_response_json=$6::jsonb,duration_ms=$7,updated_at=now()
       WHERE client_record_id=$1 AND meta_message_id=$2`,
      [state.clientRecordId, input.metaMessageId, send.ok ? 'sent' : 'failed',
       JSON.stringify(decision), send.providerMessageId, JSON.stringify(send), durationMs],
    );
    return {
      handled: true,
      duplicate: false,
      reason: send.ok ? 'edge_sent' : 'edge_send_failed',
      durationMs,
      decision,
      sent: send.ok,
      providerMessageId: send.providerMessageId,
      sendError: send.error,
    };
  }

  private notHandled(reason: string, started: number): ActiveTurnOutput {
    return {
      handled: false,
      duplicate: false,
      reason,
      durationMs: Number((performance.now() - started).toFixed(3)),
      sent: false,
      providerMessageId: '',
      sendError: '',
    };
  }
}
