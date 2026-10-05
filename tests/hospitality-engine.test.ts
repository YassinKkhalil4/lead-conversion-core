import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { evaluateConversation } from '../src/domain/engine.js';
import type { ConversationState } from '../src/domain/types.js';

const seed = JSON.parse(
  readFileSync(new URL('../config/seed-hospitality.json', import.meta.url), 'utf8'),
) as CompileInput;
const config = compileConfig({ ...seed, now: '2026-10-05T00:00:00.000Z' });
// Monday 5 October 2026 in Barcelona.
const today = { year: 2026, month: 10, day: 5 };

function fresh(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    clientRecordId: 'recCLIENT00000003', clientId: 'venue_demo', phoneNormalized: '+34600000000',
    leadRecordId: 'recLEAD000000003', leadId: 'lead_demo', leadName: 'Marta', companyName: 'Cal Demo',
    projectName: 'Cal Demo Gràcia', projectRecordId: 'recPROJECT000003', preferredLanguage: '',
    currentStage: '', currentQuestionKey: '', answers: {}, retryCount: 0, status: 'in_qualification',
    humanTakeover: false, stopFollowUp: false, closedStatus: '', appointmentStatus: '',
    assignedSalespersonRecordId: '', assignedSalespersonPhone: '',
    lastInboundAt: '2026-10-05T10:00:00.000Z', conversationWindowExpiresAt: '2026-10-06T10:00:00.000Z',
    conversationEngine: 'edge', stateAuthority: 'edge', configVersion: config.version, stateVersion: 0,
    ...overrides,
  };
}

function run(turns: Array<{ text?: string; option?: string }>) {
  let state = fresh();
  const decisions = [];
  for (const turn of turns) {
    const decision = evaluateConversation({
      state, config, today,
      ...(turn.text !== undefined ? { messageText: turn.text } : {}),
      ...(turn.option !== undefined ? { messageOptionId: turn.option } : {}),
    });
    decisions.push(decision);
    state = decision.nextState;
  }
  return decisions;
}

describe('hospitality conversation', () => {
  it('books a table in Spanish end to end', () => {
    const d = run([
      { text: 'hola' }, { option: 'lang_es' }, { option: 'perm_yes' },
      { text: 'somos cuatro' }, { text: 'el viernes cena' }, { option: 'zone_terrace' },
    ]);
    expect(d[0]?.interactiveOptions?.map((o) => o.id)).toEqual(['lang_es', 'lang_ca', 'lang_en']);
    expect(d[1]?.text).toBe('Hola Marta 👋 Soy el asistente de Cal Demo. ¿Te hago unas preguntas rápidas para reservar tu mesa?');
    expect(d[3]?.text).toBe('¿Qué día, y comida o cena? Por ejemplo: "viernes cena".');
    expect(d[4]?.interactiveOptions?.map((o) => o.label)).toEqual(['Sala interior', 'Terraza']);
    const last = d[5]!;
    expect(last.action).toBe('complete');
    const completed = last.outboxEvents.find((e) => e.eventType === 'qualification_completed');
    expect(completed?.payload.qualification).toMatchObject({
      party_size: '4',
      date_shift: '2026-10-09|dinner',
      zone: 'terrace',
    });
    // No score is produced for a reservation: the hook offers no appointment path either.
    expect(last.nextState.currentStage).toBe('qualified');
  });

  it('books in Catalan', () => {
    const d = run([
      { text: 'hola' }, { option: 'lang_ca' }, { option: 'perm_yes' },
      { text: 'dues persones' }, { text: 'demà dinar' }, { text: 'Terrassa' },
    ]);
    expect(d[3]?.text).toBe('Quin dia, i dinar o sopar? Per exemple: "divendres sopar".');
    const done = d[5]!.outboxEvents.find((e) => e.eventType === 'qualification_completed');
    expect(done?.payload.qualification).toMatchObject({ party_size: '2', date_shift: '2026-10-06|lunch', zone: 'terrace' });
  });

  it('asks again, once, for a party size it cannot read, and never saves it', () => {
    const d = run([{ text: 'hola' }, { option: 'lang_en' }, { option: 'perm_yes' }, { text: 'lots' }]);
    expect(d[3]?.replyKey).toBe('clarify_invalid');
    expect(d[3]?.nextState.answers.q_party_size).toBeUndefined();
  });

  it('needs a day and a shift together', () => {
    const d = run([{ text: 'hola' }, { option: 'lang_en' }, { option: 'perm_yes' }, { text: '2' }, { text: 'friday' }]);
    expect(d[4]?.replyKey).toBe('clarify_invalid');
  });

  it('declining the first question pauses, in any of the three languages', () => {
    for (const [lang, no] of [['lang_es', 'Ahora no'], ['lang_ca', 'Ara no'], ['lang_en', 'Not now']] as const) {
      const d = run([{ text: 'hola' }, { option: lang }, { text: no }]);
      expect(d[2]?.action).toBe('pause');
    }
  });
});
