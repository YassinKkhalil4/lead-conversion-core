import type { PoolClient } from 'pg';
import { ConfigRepository } from '../repositories/config-repository.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { AuditRepository } from '../infrastructure/runtime.js';
import { suppressionReason } from '../domain/engine.js';
import type { ConversationState, Language } from '../domain/types.js';

export interface ConversationActivationInput {
  clientId: string;
  clientRecordId: string;
  phoneE164: string;
  leadId: string;
  leadRecordId: string;
  leadName?: string;
  companyName?: string;
  projectName?: string;
  projectRecordId?: string;
  preferredLanguage?: Language | '';
  receivedAt?: string;
  actorId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface ConversationActivationResult {
  state: ConversationState | null;
  activated: boolean;
  skippedReason: string;
}

/**
 * Creates the `edge_conversations` row a lead needs before the runtime will
 * answer anything from that number.
 *
 * Both lead paths use this. Direct WhatsApp inbound calls it for a number it
 * has just captured, and `LeadIntakeService` calls it for a form or lead-ad
 * lead — without it an intake-created lead is answered with
 * `conversation_not_activated` the moment it replies.
 */
export class ConversationActivationService {
  constructor(
    private readonly configs = new ConfigRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  async activate(client: PoolClient, input: ConversationActivationInput): Promise<ConversationActivationResult> {
    if (!input.clientRecordId || !input.phoneE164 || !input.leadId) {
      return { state: null, activated: false, skippedReason: 'conversation_activation_identity_incomplete' };
    }

    // A client with no published configuration has no questions to ask. That
    // is not a reason to fail an otherwise good lead, so record it and move on.
    let snapshot;
    try {
      snapshot = await this.configs.getActiveSnapshot(input.clientRecordId, client);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('No active configuration version')) throw error;
      await this.audit.record(client, {
        eventType: 'conversation.activation_skipped',
        actorType: 'system',
        actorId: input.actorId || 'conversation-activation-service',
        aggregateType: 'lead',
        aggregateId: input.leadId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
        payload: { reason: 'no_active_configuration_version', clientRecordId: input.clientRecordId },
      });
      return { state: null, activated: false, skippedReason: 'no_active_configuration_version' };
    }

    await this.conversations.lockScope(client, input.clientRecordId, input.phoneE164);
    const existing = await this.conversations.find(client, input.clientRecordId, input.phoneE164);
    const state = await this.conversations.getOrCreate(
      client,
      {
        eventId: input.causationId || '',
        metaMessageId: '',
        clientRecordId: input.clientRecordId,
        clientId: input.clientId,
        phoneNormalized: input.phoneE164,
        leadRecordId: input.leadRecordId || input.leadId,
        leadId: input.leadId,
        leadName: input.leadName || '',
        companyName: input.companyName || '',
        projectName: input.projectName || '',
        projectRecordId: input.projectRecordId || '',
        preferredLanguage: input.preferredLanguage || '',
        ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
      },
      snapshot,
      { conversationEngine: 'edge', stateAuthority: 'edge' },
    );

    if (!existing) {
      // A conversation can legitimately be born silent — an operator may have
      // taken the lead over before first contact. Record it at creation so the
      // silence is visible immediately, rather than only when an inbound turn
      // is later dropped. On the intake path no inbound turn ever arrives, so
      // without this there is no audit row at all.
      const bornSuppressed = suppressionReason(state);
      if (bornSuppressed) {
        await this.audit.record(client, {
          eventType: 'conversation.activated_suppressed',
          actorType: 'system',
          actorId: input.actorId || 'conversation-activation-service',
          aggregateType: 'lead',
          aggregateId: input.leadId,
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          ...(input.causationId ? { causationId: input.causationId } : {}),
          payload: {
            reason: bornSuppressed,
            clientRecordId: input.clientRecordId,
            currentStage: state.currentStage,
            status: state.status,
            humanTakeover: state.humanTakeover,
            stopFollowUp: state.stopFollowUp,
            appointmentStatus: state.appointmentStatus,
          },
          after: { conversationId: state.conversationId || '', currentStage: state.currentStage },
        });
      }
      await this.audit.record(client, {
        eventType: 'conversation.activated',
        actorType: 'system',
        actorId: input.actorId || 'conversation-activation-service',
        aggregateType: 'lead',
        aggregateId: input.leadId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
        payload: {
          clientRecordId: input.clientRecordId,
          configVersion: snapshot.versionKey,
          preferredLanguage: input.preferredLanguage || '',
          suppressedAtActivation: bornSuppressed || '',
        },
        after: { conversationId: state.conversationId || '', currentStage: state.currentStage },
      });
    }

    return { state, activated: !existing, skippedReason: '' };
  }
}
