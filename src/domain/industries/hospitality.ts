import type { CompiledConfig, CompiledQuestion, ConversationState } from '../types.js';
import type { IndustryHooks } from './types.js';

/**
 * Reservations. The questions are linear: permission, party size, date and
 * shift, zone, deposit. The availability check and the booking itself happen
 * in the services that consume `qualification_completed`, not in this pure
 * function, so the engine never reads a floor plan.
 */

const PAUSE_ANSWERS = ['no', 'not now', 'ahora no', 'mejor no', 'ara no', 'millor no'];

function saveAnswer(state: ConversationState, question: CompiledQuestion, value: string): Record<string, string> {
  const answers = { ...state.answers };
  if (question.saveKey && question.saveKey !== 'q_permission') answers[question.saveKey] = value;
  return answers;
}

function qualificationPayload(answers: Record<string, string>): Record<string, string> {
  const payload: Record<string, string> = {
    party_size: answers.q_party_size || '',
    date_shift: answers.q_date_shift || '',
    zone: answers.q_zone || '',
    deposit: answers.q_deposit || '',
    notes: answers.qualification_notes || '',
  };
  const consumed = new Set(['q_party_size', 'q_date_shift', 'q_zone', 'q_deposit', 'qualification_notes']);
  for (const [key, value] of Object.entries(answers)) {
    if (!consumed.has(key)) payload[key.replace(/^q_/, '')] = value;
  }
  return payload;
}

function nextQuestionAfter(config: CompiledConfig, question: CompiledQuestion): CompiledQuestion | undefined {
  const index = config.questions.findIndex((candidate) => candidate.questionKey === question.questionKey);
  return index >= 0 ? config.questions[index + 1] : undefined;
}

export const hospitalityHooks: IndustryHooks = {
  saveAnswer,
  qualificationPayload,
  nextQuestionAfter,
  isPauseAnswer: (question, lowerValue) => question.saveKey === 'q_permission' && PAUSE_ANSWERS.includes(lowerValue),
  offersAppointment: () => false,
};
