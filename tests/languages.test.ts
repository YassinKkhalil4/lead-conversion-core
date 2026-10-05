import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { evaluateConversation } from '../src/domain/engine.js';
import { localized } from '../src/domain/language.js';
import { isOptOutMessage } from '../src/domain/opt-out.js';
import type { ConversationState } from '../src/domain/types.js';

const seed = JSON.parse(
  readFileSync(new URL('../config/seed-real-estate.json', import.meta.url), 'utf8'),
) as CompileInput;

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    clientRecordId: 'recCLIENT00000002',
    clientId: 'venue_demo',
    phoneNormalized: '+34600000000',
    leadRecordId: 'recLEAD000000002',
    leadId: 'lead_demo',
    leadName: 'Marta',
    companyName: 'Cal Demo',
    projectName: 'Cal Demo Gràcia',
    projectRecordId: 'recPROJECT000002',
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
    lastInboundAt: '2026-10-05T10:00:00.000Z',
    conversationWindowExpiresAt: '2026-10-06T10:00:00.000Z',
    conversationEngine: 'edge',
    stateAuthority: 'edge',
    configVersion: 'test',
    stateVersion: 0,
    ...overrides,
  };
}

/** A two-question hospitality config in Spanish, Catalan and English. */
const venue = compileConfig({
  industry: 'hospitality',
  languages: ['Spanish', 'Catalan', 'English'],
  questions: [
    {
      id: 'q1',
      fields: {
        'Question Key': 'q_permission', 'Stage Key': 'awaiting_permission', 'Saves To': 'q_permission', Order: 1, Active: true,
        'Question Type': 'Buttons', English: 'Shall we book a table?', Spanish: '¿Reservamos mesa?', Catalan: 'Reservem taula?', Arabic: '',
      },
    },
    {
      id: 'q2',
      fields: {
        'Question Key': 'q_party_size', 'Stage Key': 'asking_party_size', 'Saves To': 'q_party_size', Order: 2, Active: true,
        'Question Type': 'Free Text', English: 'How many people?', Spanish: '¿Cuántas personas?', Catalan: 'Quantes persones?', Arabic: '',
      },
    },
  ],
  options: [
    { id: 'o1', fields: { Question: ['q1'], 'Option Key': 'perm_yes', Value: 'yes', Order: 1, Active: true, English: 'Yes', Spanish: 'Sí', Catalan: 'Sí', Arabic: '' } },
    { id: 'o2', fields: { Question: ['q1'], 'Option Key': 'perm_no', Value: 'no', Order: 2, Active: true, English: 'Not now', Spanish: 'Ahora no', Catalan: 'Ara no', Arabic: '' } },
  ],
  messages: [
    { id: 'm1', fields: { 'Message Key': 'language_selection', Active: true, English: 'Choose your language', Spanish: 'Elige tu idioma', Catalan: 'Tria el teu idioma', Arabic: '' } },
    { id: 'm2', fields: { 'Message Key': 'paused_ack', Active: true, English: 'No problem', Spanish: 'Sin problema', Catalan: 'Cap problema', Arabic: '' } },
  ],
});

describe('Spanish and Catalan', () => {
  it('leaves the published real-estate config byte for byte as it was', () => {
    // Recorded from the compiler before Spanish and Catalan were added. A different
    // checksum would re-version every real-estate tenant's pinned configuration.
    expect(compileConfig({ ...seed, now: '2026-07-28T00:00:00.000Z' }).version).toBe(
      '4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d',
    );
  });

  it('offers the tenant\'s languages as buttons, in order, in the first language', () => {
    const reply = evaluateConversation({ state: state(), config: venue, messageText: 'hola' });
    expect(reply.replyKey).toBe('language_selection');
    expect(reply.text).toBe('Elige tu idioma');
    expect(reply.interactiveOptions?.map((o) => o.id)).toEqual(['lang_es', 'lang_ca', 'lang_en']);
  });

  it.each([
    ['lang_ca', 'Catalan'],
    ['2', 'Catalan'],
    ['Català', 'Catalan'],
    ['español', 'Spanish'],
    ['1', 'Spanish'],
    ['english', 'English'],
    ['3', 'English'],
  ])('reads %s as %s', (input, language) => {
    const reply = evaluateConversation({
      state: state({ currentStage: 'language_selection', currentQuestionKey: 'language_selection' }),
      config: venue,
      messageText: input,
    });
    expect(reply.nextState.preferredLanguage).toBe(language);
  });

  it('asks the next question in the guest\'s language', () => {
    const reply = evaluateConversation({
      state: state({ preferredLanguage: 'Catalan', currentStage: 'awaiting_permission', currentQuestionKey: 'q_permission' }),
      config: venue,
      messageOptionId: 'perm_yes',
    });
    expect(reply.text).toBe('Quantes persones?');
  });

  it('shows option labels in the guest\'s language and accepts them typed', () => {
    const ask = evaluateConversation({ state: state({ preferredLanguage: 'Spanish' }), config: venue, messageText: 'hola' });
    expect(ask.text).toBe('¿Reservamos mesa?');
    const declined = evaluateConversation({
      state: state({ preferredLanguage: 'Spanish', currentStage: 'awaiting_permission', currentQuestionKey: 'q_permission' }),
      config: venue,
      messageText: 'Ahora no',
    });
    expect(declined.action).toBe('pause');
    expect(declined.text).toBe('Sin problema');
  });

  it('falls back to English when a config has no translation', () => {
    expect(localized({ English: 'Hello', Arabic: '' }, 'Spanish')).toBe('Hello');
    expect(localized({ English: '', Arabic: 'مرحبا' }, 'Catalan')).toBe('مرحبا');
  });

  it('still answers real estate in English and Arabic only', () => {
    const realEstate = compileConfig({ ...seed, now: '2026-07-28T00:00:00.000Z' });
    const reply = evaluateConversation({ state: state(), config: realEstate, messageText: 'hi' });
    expect(reply.interactiveOptions?.map((o) => o.id)).toEqual(['lang_en', 'lang_ar']);
  });
});

describe('opt-out in Spanish and Catalan', () => {
  it.each(['baja', 'Dar de baja', 'no me interesa', 'parar', 'no m\'interessa', 'donar de baixa', 'aturar'])(
    'opts out on "%s"',
    (text) => expect(isOptOutMessage(text)).toBe(true),
  );

  it.each(['una mesa para cuatro', 'mesa para 2 el viernes', 'una taula per a quatre', 'me interesa el sábado'])(
    'does not opt out on "%s"',
    (text) => expect(isOptOutMessage(text)).toBe(false),
  );
});
