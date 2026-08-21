import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { APPOINTMENT_SLOT_STAGE, evaluateConversation } from '../src/domain/engine.js';
import { parseEgpAmount, parseEgpRange } from '../src/domain/normalization.js';
import type { ConversationState } from '../src/domain/types.js';

const seed = JSON.parse(
  readFileSync(new URL('../config/seed-real-estate.json', import.meta.url), 'utf8'),
) as CompileInput;
const config = compileConfig({ ...seed, now: '2026-07-28T00:00:00.000Z' });

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    clientRecordId: 'recCLIENT00000001',
    clientId: 'client_demo',
    phoneNormalized: '+201000000000',
    leadRecordId: 'recLEAD000000001',
    leadId: 'lead_demo',
    leadName: 'Ahmed',
    companyName: 'Demo Realty',
    projectName: 'Palm Heights',
    projectRecordId: 'recPROJECT000001',
    preferredLanguage: 'English',
    currentStage: 'awaiting_permission',
    currentQuestionKey: 'q_permission',
    answers: {},
    retryCount: 0,
    status: 'in_qualification',
    humanTakeover: false,
    stopFollowUp: false,
    closedStatus: '',
    appointmentStatus: '',
    assignedSalespersonRecordId: '',
    assignedSalespersonPhone: '',
    lastInboundAt: '2026-07-28T00:00:00.000Z',
    conversationWindowExpiresAt: '2026-07-29T00:00:00.000Z',
    conversationEngine: 'legacy',
    stateAuthority: 'legacy',
    configVersion: config.version,
    stateVersion: 0,
    ...overrides,
  };
}

describe('parsers', () => {
  it('parses Arabic half-million phrasing', () => {
    expect(parseEgpAmount('٥ مليون ونص')).toBe(5_500_000);
  });

  it('parses Arabic budget range', () => {
    expect(parseEgpRange('من ٣ لـ ٥ مليون')).toEqual({ min: 3_000_000, max: 5_000_000 });
  });
});

describe('conversation engine', () => {
  it('asks for language when none is selected', () => {
    const result = evaluateConversation({
      state: state({ preferredLanguage: '', currentStage: '', currentQuestionKey: '' }),
      config,
      messageText: 'hello',
    });
    expect(result.replyKey).toBe('language_selection');
    expect(result.stageAfter).toBe('language_selection');
    expect(result.messageKind).toBe('buttons');
  });

  it('selects English and asks permission', () => {
    const result = evaluateConversation({
      state: state({ preferredLanguage: '', currentStage: 'language_selection' }),
      config,
      messageOptionId: 'lang_en',
    });
    expect(result.stageAfter).toBe('awaiting_permission');
    expect(result.replyKey).toBe('q_permission');
    expect(result.nextState.preferredLanguage).toBe('English');
  });

  it('pauses after declined permission', () => {
    const result = evaluateConversation({
      state: state(),
      config,
      messageOptionId: 'perm_no',
    });
    expect(result.action).toBe('pause');
    expect(result.stageAfter).toBe('paused');
    expect(result.replyKey).toBe('paused_ack');
  });

  it('advances from permission to location', () => {
    const result = evaluateConversation({
      state: state(),
      config,
      messageOptionId: 'perm_yes',
    });
    expect(result.stageAfter).toBe('asking_location');
    expect(result.replyKey).toBe('q_location');
  });

  it('skips down payment when payment is cash', () => {
    const result = evaluateConversation({
      state: state({
        currentStage: 'asking_payment_plan',
        currentQuestionKey: 'q_payment_plan',
      }),
      config,
      messageOptionId: 'pay_cash',
    });
    expect(result.stageAfter).toBe('asking_timeline');
    expect(result.nextState.answers.q_payment_plan).toBe('Cash');
  });

  it('asks down payment for installments', () => {
    const result = evaluateConversation({
      state: state({
        currentStage: 'asking_payment_plan',
        currentQuestionKey: 'q_payment_plan',
      }),
      config,
      messageOptionId: 'pay_installments',
    });
    expect(result.stageAfter).toBe('asking_down_payment');
  });

  it('clarifies first invalid selectable answer', () => {
    const result = evaluateConversation({
      state: state({ currentStage: 'asking_unit_type', currentQuestionKey: 'q_unit_type' }),
      config,
      messageText: 'something unrelated',
    });
    expect(result.replyKey).toBe('clarify_invalid');
    expect(result.stageAfter).toBe('asking_unit_type');
    expect(result.nextState.retryCount).toBe(1);
    expect(result.needsAsyncAi).toBe(true);
  });

  it('keeps raw answer and advances on second invalid response', () => {
    const result = evaluateConversation({
      state: state({
        currentStage: 'asking_unit_type',
        currentQuestionKey: 'q_unit_type',
        retryCount: 1,
      }),
      config,
      messageText: 'custom loft',
    });
    expect(result.stageAfter).toBe('asking_budget');
    expect(result.nextState.answers.q_unit_type).toBe('custom loft');
    expect(result.parseSource).toBe('raw_fallback');
  });

  it('completes after site visit answer', () => {
    const result = evaluateConversation({
      state: state({
        currentStage: 'asking_site_visit',
        currentQuestionKey: 'q_site_visit',
        answers: {
          q_location: 'New Cairo',
          q_unit_type: 'Villa',
          q_budget_min: '3000000',
          q_budget_max: '5000000',
          q_payment_plan: 'Cash',
          q_timeline: 'Immediate',
          q_purpose: 'Primary Residence',
        },
      }),
      config,
      messageOptionId: 'sv_no',
    });
    expect(result.action).toBe('complete');
    expect(result.stageAfter).toBe('qualified');
    expect(result.replyKey).toBe('qualified_closing');
    expect(result.outboxEvents.some((event) => event.eventType === 'qualification_completed')).toBe(true);
  });

  it('parks an accepted site visit on the slot stage instead of closing', () => {
    const result = evaluateConversation({
      state: state({
        currentStage: 'asking_site_visit',
        currentQuestionKey: 'q_site_visit',
        answers: { q_location: 'New Cairo', q_unit_type: 'Villa' },
      }),
      config,
      messageOptionId: 'sv_yes',
    });

    expect(result.replyKey).toBe('appointment_slot_offer');
    expect(result.stageAfter).toBe(APPOINTMENT_SLOT_STAGE);
    expect(result.nextState.currentStage).toBe(APPOINTMENT_SLOT_STAGE);
    expect(result.nextState.status).toBe('qualified');
    // Scoring and routing still hang off qualification completion.
    expect(result.outboxEvents.some((event) => event.eventType === 'qualification_completed')).toBe(true);
    expect(result.outboxEvents.some((event) => event.eventType === 'appointment_slot_offer_requested')).toBe(true);
  });

  it('reads a slot tap off the interactive list row id', () => {
    const offerId = '11111111-1111-4111-8111-111111111111';
    const slotId = '22222222-2222-4222-8222-222222222222';
    const result = evaluateConversation({
      state: state({ currentStage: APPOINTMENT_SLOT_STAGE, currentQuestionKey: '' }),
      config,
      messageOptionId: `appt:${offerId}:${slotId}`,
    });

    expect(result.replyKey).toBe('appointment_slot_selected');
    expect(result.outboxEvents[0]?.payload).toEqual({
      appointmentOfferId: offerId,
      appointmentSlotId: slotId,
    });
  });

  it('re-prompts an unparseable slot reply once, then closes without looping', () => {
    const base = state({ currentStage: APPOINTMENT_SLOT_STAGE, currentQuestionKey: '' });

    const first = evaluateConversation({ state: base, config, messageText: 'whenever suits you' });
    expect(first.replyKey).toBe('appointment_slot_reprompt');
    expect(first.stageAfter).toBe(APPOINTMENT_SLOT_STAGE);
    expect(first.nextState.retryCount).toBe(1);

    const second = evaluateConversation({
      state: { ...base, retryCount: first.nextState.retryCount },
      config,
      messageText: 'still not a slot',
    });
    expect(second.replyKey).toBe('qualified_closing');
    expect(second.stageAfter).toBe('qualified');
    expect(second.outboxEvents.some((event) => event.eventType === 'appointment_offer_abandoned')).toBe(true);
  });

  it('does not route the slot stage into the legacy handler or the handoff reply', () => {
    const legacy = evaluateConversation({
      state: state({ currentStage: 'appointment_slot_selection' }),
      config,
      messageText: 'hello',
    });
    expect(legacy.replyKey).toBe('legacy_appointment_router');

    const parked = evaluateConversation({
      state: state({ currentStage: APPOINTMENT_SLOT_STAGE }),
      config,
      messageText: 'hello',
    });
    expect(parked.action).not.toBe('fallback');
    expect(parked.replyKey).not.toBe('already_handed_off');
  });
});
