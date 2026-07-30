import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';
import { getEnv } from '../config/env.js';
import { duplicateMessagesTotal, evaluationDurationMs, evaluationsTotal } from '../config/metrics.js';
import { withTransaction } from '../db/transaction.js';
import { evaluateConversation } from '../domain/engine.js';
import type { ReplyDecision, ShadowEvaluateInput } from '../domain/types.js';
import { ConfigRepository } from '../repositories/config-repository.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { OutboxRepository } from '../repositories/outbox-repository.js';
import { compareParity, type ParityResult } from './parity.js';

interface StoredEvaluation {
  decision_json: ReplyDecision;
  duration_ms: string | number;
  parity_status: ParityResult['status'];
  parity_differences_json: ParityResult['differences'];
}

export interface ShadowEvaluateOutput {
  duplicate: boolean;
  durationMs: number;
  parity: ParityResult;
  decision: ReplyDecision;
}

export class ShadowEvaluator {
  constructor(
    private readonly configs = new ConfigRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly outbox = new OutboxRepository(),
  ) {}

  async evaluate(input: ShadowEvaluateInput): Promise<ShadowEvaluateOutput> {
    const started = performance.now();
    const output = await withTransaction(async (client) => this.evaluateInTransaction(client, input, started));
    evaluationDurationMs.observe({ result: output.decision.action }, output.durationMs);
    evaluationsTotal.inc({ result: output.decision.action, stage: output.decision.stageAfter || 'none' });
    return output;
  }

  private async evaluateInTransaction(
    client: PoolClient,
    input: ShadowEvaluateInput,
    started: number,
  ): Promise<ShadowEvaluateOutput> {
    const env = getEnv();
    await this.conversations.lockScope(client, input.clientRecordId, input.phoneNormalized);

    const activeConfig = await this.configs.getActiveSnapshot(input.clientRecordId, client);
    const state = await this.conversations.getOrCreate(client, input, activeConfig, {
      conversationEngine: env.DEFAULT_CONVERSATION_ENGINE,
      stateAuthority: input.stateAuthority || env.SHADOW_STATE_AUTHORITY,
    });
    if (!state.conversationId) throw new Error('Conversation ID missing after create');

    const duplicate = await client.query<StoredEvaluation>(
      `SELECT decision_json, duration_ms, parity_status, parity_differences_json
       FROM edge_shadow_evaluations
       WHERE conversation_id=$1 AND meta_message_id=$2
       LIMIT 1`,
      [state.conversationId, input.metaMessageId],
    );
    const prior = duplicate.rows[0];
    if (prior) {
      duplicateMessagesTotal.inc();
      return {
        duplicate: true,
        durationMs: Number(prior.duration_ms),
        parity: { status: prior.parity_status, differences: prior.parity_differences_json || {} },
        decision: prior.decision_json,
      };
    }

    const config = await this.configs.getByVersion(state.configVersion, client);

    await client.query(
      `INSERT INTO edge_message_events (
         conversation_id, client_record_id, direction, external_event_id,
         meta_message_id, message_type, message_text, option_id, raw_payload
       ) VALUES ($1,$2,'inbound',$3,$4,'text',$5,$6,$7::jsonb)
       ON CONFLICT (client_record_id, meta_message_id) WHERE meta_message_id <> '' DO NOTHING`,
      [
        state.conversationId,
        input.clientRecordId,
        input.eventId,
        input.metaMessageId,
        input.messageText || '',
        input.messageOptionId || '',
        JSON.stringify(input),
      ],
    );

    const decision = evaluateConversation({
      state,
      config,
      ...(input.messageText !== undefined ? { messageText: input.messageText } : {}),
      ...(input.messageOptionId !== undefined ? { messageOptionId: input.messageOptionId } : {}),
    });
    decision.nextState.conversationId = state.conversationId;
    decision.nextState.configVersion = state.configVersion;
    await this.conversations.update(client, decision.nextState);

    const parity = compareParity(decision, input.legacyExpected);
    const durationMs = Number((performance.now() - started).toFixed(3));

    await client.query(
      `INSERT INTO edge_shadow_evaluations (
         conversation_id, inbound_event_id, meta_message_id, config_version,
         stage_before, stage_after, decision_json, legacy_expected_json,
         parity_status, parity_differences_json, duration_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11)`,
      [
        state.conversationId,
        input.eventId,
        input.metaMessageId,
        state.configVersion,
        decision.stageBefore,
        decision.stageAfter,
        JSON.stringify(decision),
        input.legacyExpected ? JSON.stringify(input.legacyExpected) : null,
        parity.status,
        JSON.stringify(parity.differences),
        durationMs,
      ],
    );

    const parked = env.EDGE_MODE === 'shadow';
    const basePayload = {
      leadRecordId: input.leadRecordId,
      clientRecordId: input.clientRecordId,
      phoneNormalized: input.phoneNormalized,
      metaMessageId: input.metaMessageId,
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
          receivedAt: input.receivedAt || input.lastInboundAt || new Date().toISOString(),
        },
      },
      ...decision.outboxEvents,
    ];
    if (decision.stageBefore !== decision.stageAfter) {
      events.push({
        eventType: 'conversation_stage_changed',
        payload: { from: decision.stageBefore, to: decision.stageAfter },
      });
    }
    if (decision.action !== 'no_reply' && decision.text) {
      events.push({
        eventType: 'outbound_message_predicted',
        payload: {
          replyKey: decision.replyKey,
          text: decision.text,
          messageKind: decision.messageKind,
          interactiveOptions: decision.interactiveOptions || [],
        },
      });
    }

    for (const [index, event] of events.entries()) {
      await this.outbox.enqueue(client, {
        conversationId: state.conversationId,
        eventType: event.eventType,
        idempotencyKey: `${input.clientRecordId}:${input.metaMessageId}:${event.eventType}:${index}`,
        payload: { ...basePayload, ...event.payload },
        parked,
      });
    }

    return { duplicate: false, durationMs, parity, decision };
  }
}
