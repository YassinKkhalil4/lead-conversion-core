import type { CompiledConfig, CompiledQuestion, ConversationState } from '../types.js';
import type { IndustryHooks } from './types.js';

/** Moved verbatim from the engine; tests/engine-golden.test.ts pins its behaviour. */

const SITE_VISIT_ACCEPTED = ['yes', 'نعم', 'أيوه', 'ايوه'];

function saveAnswer(state: ConversationState, question: CompiledQuestion, value: string): Record<string, string> {
  const answers = { ...state.answers };
  if (question.saveKey === 'q_budget') {
    const [min = '0', max = min] = value.split('-');
    answers.q_budget_min = min;
    answers.q_budget_max = max;
  } else if (question.saveKey && question.saveKey !== 'q_permission') {
    answers[question.saveKey] = value;
  }
  return answers;
}

function qualificationPayload(answers: Record<string, string>): Record<string, string> {
  const payload: Record<string, string> = {
    location: answers.q_location || '',
    unit_type: answers.q_unit_type || '',
    budget_min: answers.q_budget_min || '',
    budget_max: answers.q_budget_max || '',
    down_payment: answers.q_down_payment || '',
    payment_plan: answers.q_payment_plan || '',
    timeline: answers.q_timeline || '',
    purpose: answers.q_purpose || '',
    site_visit: answers.q_site_visit || '',
    notes: answers.qualification_notes || '',
  };
  const consumed = new Set([
    'q_location',
    'q_unit_type',
    'q_budget_min',
    'q_budget_max',
    'q_down_payment',
    'q_payment_plan',
    'q_timeline',
    'q_purpose',
    'q_site_visit',
    'qualification_notes',
  ]);
  for (const [key, value] of Object.entries(answers)) {
    if (!consumed.has(key)) payload[key.replace(/^q_/, '')] = value;
  }
  return payload;
}

function nextQuestionAfter(
  config: CompiledConfig,
  question: CompiledQuestion,
  parsedValue: string,
): CompiledQuestion | undefined {
  if (question.saveKey === 'q_payment_plan' && parsedValue !== 'Installments') {
    return config.questions.find((candidate) => candidate.stageKey === 'asking_timeline');
  }
  const index = config.questions.findIndex((candidate) => candidate.questionKey === question.questionKey);
  return index >= 0 ? config.questions[index + 1] : undefined;
}

export const realEstateHooks: IndustryHooks = {
  saveAnswer,
  qualificationPayload,
  nextQuestionAfter,
  isPauseAnswer: (question, lowerValue) =>
    question.saveKey === 'q_permission' && ['no', 'مش دلوقتي'].includes(lowerValue),
  offersAppointment: (question, value) =>
    question.saveKey === 'q_site_visit' && SITE_VISIT_ACCEPTED.includes(value.trim().toLocaleLowerCase()),
};
