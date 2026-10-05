import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { evaluateConversation } from '../src/domain/engine.js';
import type { ConversationState, ReplyDecision } from '../src/domain/types.js';

/**
 * Golden replay of the real-estate conversation engine.
 *
 * The hospitality work moves real-estate branches behind industry hooks and
 * widens the language type. None of that may change what a real-estate lead
 * sees, so every scenario below is replayed turn by turn and the complete
 * ReplyDecision of each turn (text, buttons, events, next state) is compared
 * with a snapshot recorded from the engine before the change.
 *
 * Update the snapshot only for an intended real-estate behaviour change.
 */

const seed = JSON.parse(
  readFileSync(new URL('../config/seed-real-estate.json', import.meta.url), 'utf8'),
) as CompileInput;
const config = compileConfig({ ...seed, now: '2026-07-28T00:00:00.000Z' });

function base(overrides: Partial<ConversationState> = {}): ConversationState {
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
    preferredLanguage: '',
    currentStage: '',
    currentQuestionKey: '',
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
    conversationEngine: 'edge',
    stateAuthority: 'edge',
    configVersion: config.version,
    stateVersion: 0,
    ...overrides,
  };
}

type Turn = { text?: string; option?: string };

function replay(start: ConversationState, turns: Turn[]): ReplyDecision[] {
  const out: ReplyDecision[] = [];
  let state = start;
  for (const turn of turns) {
    const decision = evaluateConversation({
      state,
      config,
      ...(turn.text !== undefined ? { messageText: turn.text } : {}),
      ...(turn.option !== undefined ? { messageOptionId: turn.option } : {}),
    });
    out.push(decision);
    state = decision.nextState;
  }
  return out;
}

const T = (text: string): Turn => ({ text });
const O = (option: string): Turn => ({ option });

const scenarios: Record<string, { start: ConversationState; turns: Turn[] }> = {
  'first message asks for a language': { start: base(), turns: [T('hi')] },
  'language by button, then the whole flow in English': {
    start: base(),
    turns: [
      T('hi'), O('lang_en'), O('perm_yes'), T('New Cairo'), O('unit_villa'), O('budget_5_10'),
      O('pay_installments'), T('500k'), O('tl_3m'), O('pur_investment'), O('sv_no'),
    ],
  },
  'language by button, then the whole flow in Arabic with a site visit': {
    start: base(),
    turns: [
      T('اهلا'), O('lang_ar'), O('perm_yes'), T('التجمع'), O('unit_apartment'), T('من ٣ لـ ٥ مليون'),
      O('pay_cash'), O('tl_now'), O('pur_both'), O('sv_yes'),
    ],
  },
  'language typed as a number or a name': {
    start: base(),
    turns: [T('hi'), T('1')],
  },
  'language typed as Arabic name': { start: base(), turns: [T('hi'), T('عربي')] },
  'language not understood twice falls back': { start: base(), turns: [T('hi'), T('bonjour'), T('?')] },
  'unsupported language word is not understood': { start: base(), turns: [T('hi'), T('es')] },
  'permission declined pauses': {
    start: base({ preferredLanguage: 'English', currentStage: 'awaiting_permission', currentQuestionKey: 'q_permission' }),
    turns: [O('perm_no')],
  },
  'cash skips the down payment': {
    start: base({ preferredLanguage: 'English', currentStage: 'asking_payment_plan', currentQuestionKey: 'q_payment_plan' }),
    turns: [O('pay_flexible'), O('pur_residence')],
  },
  'unparsed budget retries once then keeps the raw text': {
    start: base({ preferredLanguage: 'Arabic', currentStage: 'asking_budget', currentQuestionKey: 'q_budget' }),
    turns: [T('mish 3arf'), T('mish 3arf bardo')],
  },
  'down payment amounts': {
    start: base({ preferredLanguage: 'English', currentStage: 'asking_down_payment', currentQuestionKey: 'q_down_payment' }),
    turns: [T('٥ مليون ونص')],
  },
  'qualified lead messaging again is handed off': {
    start: base({ preferredLanguage: 'English', currentStage: 'qualified', status: 'qualified' }),
    turns: [T('hello?')],
  },
  'suppressed states stay silent': {
    start: base({ preferredLanguage: 'English', currentStage: 'asking_location', humanTakeover: true }),
    turns: [T('hello')],
  },
  'stopped and unsubscribed stay silent': {
    start: base({ preferredLanguage: 'English', currentStage: 'stopped' }),
    turns: [T('hello')],
  },
  'unknown stage falls back': {
    start: base({ preferredLanguage: 'English', currentStage: 'mystery_stage' }),
    turns: [T('hello')],
  },
  'slot stage with a slot tap': {
    start: base({ preferredLanguage: 'English', currentStage: 'awaiting_appointment_slot' }),
    turns: [O('appt:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222')],
  },
  'slot stage with two unparsed replies': {
    start: base({ preferredLanguage: 'Arabic', currentStage: 'awaiting_appointment_slot' }),
    turns: [T('tomorrow'), T('tomorrow again')],
  },
};

describe('real-estate engine golden replay', () => {
  for (const [name, { start, turns }] of Object.entries(scenarios)) {
    it(name, async () => {
      await expect(JSON.stringify(replay(start, turns), null, 2)).toMatchFileSnapshot(
        `./fixtures/engine-golden/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`,
      );
    });
  }
});
