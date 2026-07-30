import { parseQuestionAnswer } from './normalization.js';
import { renderTemplate } from './render.js';
import type {
  CompiledConfig,
  CompiledQuestion,
  ConversationState,
  InteractiveOption,
  Language,
  ReplyDecision,
} from './types.js';

interface EngineInput {
  state: ConversationState;
  config: CompiledConfig;
  messageText?: string;
  messageOptionId?: string;
}

function templateVars(state: ConversationState) {
  return {
    lead_name: state.leadName,
    company_name: state.companyName,
    project_name: state.projectName,
  };
}

function messageText(config: CompiledConfig, key: string, language: Language, state: ConversationState): string {
  const message = config.messages[key];
  if (!message) return '';
  return renderTemplate(message.texts[language], templateVars(state), language);
}

function questionReply(
  state: ConversationState,
  question: CompiledQuestion,
  language: Language,
): Pick<ReplyDecision, 'text' | 'messageKind' | 'interactiveOptions'> {
  const text = renderTemplate(question.texts[language], templateVars(state), language);
  const options: InteractiveOption[] = question.options.map((option) => ({
    id: option.id,
    label: option.labels[language] || option.labels[language === 'Arabic' ? 'English' : 'Arabic'],
  }));
  const messageKind = options.length === 0 ? 'text' : question.type === 'List' || options.length > 3 ? 'list' : 'buttons';
  return {
    text,
    messageKind,
    ...(options.length > 0 ? { interactiveOptions: options } : {}),
  };
}

function languageReply(config: CompiledConfig, state: ConversationState): ReplyDecision {
  const nextState: ConversationState = {
    ...state,
    currentStage: 'language_selection',
    currentQuestionKey: 'language_selection',
    retryCount: 0,
    stateVersion: state.stateVersion + 1,
  };
  return {
    action: 'reply',
    replyKey: 'language_selection',
    text: messageText(config, 'language_selection', 'Arabic', state),
    messageKind: 'buttons',
    interactiveOptions: [
      { id: 'lang_en', label: '🇺🇸 English' },
      { id: 'lang_ar', label: '🇪🇬 العربية' },
    ],
    stageBefore: state.currentStage,
    stageAfter: 'language_selection',
    outboxEvents: [],
    nextState,
  };
}

function parseLanguage(input: { text?: string; optionId?: string }): Language | null {
  const raw = String(input.optionId || input.text || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, '');
  if (
    ['lang_en', '1', 'english', 'en', 'انجليزي', 'انجليزى', 'الانجليزية', '🇺🇸 english'].includes(raw)
  ) return 'English';
  if (
    ['lang_ar', '2', 'arabic', 'ar', 'العربية', 'عربي', 'عربى', 'مصري', 'مصرى', '🇪🇬 العربية'].includes(raw)
  ) return 'Arabic';
  return null;
}

function suppressionReason(state: ConversationState): string | null {
  const status = String(state.status || '').toLocaleLowerCase();
  const stage = String(state.currentStage || '').toLocaleLowerCase();
  const appointment = String(state.appointmentStatus || '').toLocaleLowerCase();
  const closed = String(state.closedStatus || '').toLocaleLowerCase();
  if (state.stopFollowUp) return 'stop_follow_up_true';
  if (state.humanTakeover || stage === 'human_takeover') return 'human_takeover';
  if (stage === 'stopped') return 'stopped';
  if (appointment === 'booked') return 'appointment_booked';
  if (status.includes('unsubscribed')) return 'unsubscribed';
  if (status.includes('not_interested')) return 'not_interested';
  if (status.includes('invalid_number')) return 'invalid_number';
  if (status.includes('closed_won') || status === 'won' || closed === 'won') return 'won';
  if (status.includes('closed_lost') || status === 'lost' || closed === 'lost') return 'lost';
  if (status === 'stopped') return 'stopped';
  return null;
}

function findCurrentQuestion(config: CompiledConfig, state: ConversationState): CompiledQuestion | undefined {
  if (state.currentStage) {
    const byStage = config.questions.find((question) => question.stageKey === state.currentStage);
    if (byStage) return byStage;
  }
  if (state.currentQuestionKey) {
    return config.questions.find((question) => question.questionKey === state.currentQuestionKey);
  }
  return undefined;
}

function saveAnswer(
  state: ConversationState,
  question: CompiledQuestion,
  value: string,
): Record<string, string> {
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

export function evaluateConversation(input: EngineInput): ReplyDecision {
  const { config, messageText: incomingText, messageOptionId } = input;
  const state = { ...input.state, answers: { ...input.state.answers } };
  const stageBefore = state.currentStage;

  const suppressedBy = suppressionReason(state);
  if (suppressedBy) {
    return {
      action: 'no_reply',
      replyKey: 'suppressed',
      text: '',
      messageKind: 'text',
      stageBefore,
      stageAfter: state.currentStage,
      suppressionReason: suppressedBy,
      outboxEvents: [
        { eventType: 'conversation_reply_suppressed', payload: { reason: suppressedBy } },
      ],
      nextState: state,
    };
  }

  if (state.currentStage === 'appointment_slot_selection') {
    return {
      action: 'fallback',
      replyKey: 'legacy_appointment_router',
      text: '',
      messageKind: 'text',
      stageBefore,
      stageAfter: state.currentStage,
      outboxEvents: [],
      nextState: state,
    };
  }

  if (['qualified', 'sales_handoff'].includes(state.currentStage)) {
    const language: Language = state.preferredLanguage || 'Arabic';
    return {
      action: 'handoff',
      replyKey: 'already_handed_off',
      text: messageText(config, 'already_handed_off', language, state),
      messageKind: 'text',
      stageBefore,
      stageAfter: state.currentStage,
      outboxEvents: [],
      nextState: state,
    };
  }

  if (!state.preferredLanguage && state.currentStage !== 'language_selection') {
    return languageReply(config, state);
  }

  if (state.currentStage === 'language_selection') {
    const selected = parseLanguage({
      ...(incomingText !== undefined ? { text: incomingText } : {}),
      ...(messageOptionId !== undefined ? { optionId: messageOptionId } : {}),
    });
    if (!selected && state.retryCount === 0) {
      const nextState = { ...state, retryCount: 1, stateVersion: state.stateVersion + 1 };
      return { ...languageReply(config, nextState), stageBefore, nextState };
    }
    const language: Language = selected || 'Arabic';
    const first = config.questions[0];
    if (!first) throw new Error('Compiled config has no questions');
    const nextState: ConversationState = {
      ...state,
      preferredLanguage: language,
      currentStage: first.stageKey,
      currentQuestionKey: first.questionKey,
      retryCount: 0,
      stateVersion: state.stateVersion + 1,
    };
    return {
      action: 'reply',
      replyKey: first.questionKey,
      ...questionReply(nextState, first, language),
      stageBefore,
      stageAfter: first.stageKey,
      questionKey: first.questionKey,
      saveKey: first.saveKey,
      outboxEvents: [
        {
          eventType: 'preferred_language_changed',
          payload: { language },
        },
      ],
      nextState,
    };
  }

  if (!state.currentStage) {
    const first = config.questions[0];
    if (!first) throw new Error('Compiled config has no questions');
    const language: Language = state.preferredLanguage || 'Arabic';
    const nextState: ConversationState = {
      ...state,
      currentStage: first.stageKey,
      currentQuestionKey: first.questionKey,
      retryCount: 0,
      stateVersion: state.stateVersion + 1,
    };
    return {
      action: 'reply',
      replyKey: first.questionKey,
      ...questionReply(nextState, first, language),
      stageBefore,
      stageAfter: first.stageKey,
      questionKey: first.questionKey,
      saveKey: first.saveKey,
      outboxEvents: [],
      nextState,
    };
  }

  const question = findCurrentQuestion(config, state);
  if (!question) {
    const language: Language = state.preferredLanguage || 'Arabic';
    return {
      action: 'fallback',
      replyKey: 'fallback',
      text: messageText(config, 'fallback', language, state),
      messageKind: 'text',
      stageBefore,
      stageAfter: state.currentStage,
      outboxEvents: [
        { eventType: 'shadow_unknown_stage', payload: { stage: state.currentStage } },
      ],
      nextState: state,
    };
  }

  const language: Language = state.preferredLanguage || 'Arabic';
  const parsed = parseQuestionAnswer(
    question,
    {
      ...(incomingText !== undefined ? { text: incomingText } : {}),
      ...(messageOptionId !== undefined ? { optionId: messageOptionId } : {}),
    },
    language,
  );

  let parsedValue = parsed.value;
  let parseSource: ReplyDecision['parseSource'] = parsed.source;
  let needsAsyncAi = false;

  if (!parsed.ok) {
    if (state.retryCount === 0) {
      const nextState: ConversationState = {
        ...state,
        retryCount: 1,
        stateVersion: state.stateVersion + 1,
      };
      const clarify = messageText(config, 'clarify_invalid', language, state);
      const questionOutput = questionReply(state, question, language);
      return {
        action: 'reply',
        replyKey: 'clarify_invalid',
        text: `${clarify}\n\n${questionOutput.text}`,
        messageKind: questionOutput.messageKind,
        ...(questionOutput.interactiveOptions
          ? { interactiveOptions: questionOutput.interactiveOptions }
          : {}),
        stageBefore,
        stageAfter: state.currentStage,
        questionKey: question.questionKey,
        saveKey: question.saveKey,
        needsAsyncAi: true,
        outboxEvents: [
          {
            eventType: 'shadow_ai_refinement_requested',
            payload: {
              stage: state.currentStage,
              questionKey: question.questionKey,
              raw: String(incomingText || messageOptionId || ''),
            },
          },
        ],
        nextState,
      };
    }
    parsedValue = String(incomingText || messageOptionId || '').trim().slice(0, 200) || '0';
    parseSource = 'raw_fallback';
    needsAsyncAi = true;
  }

  const finalParsedValue = parsedValue ?? '';
  const answers = saveAnswer(state, question, finalParsedValue);
  if (parseSource === 'raw_fallback') {
    const raw = String(incomingText || messageOptionId || '').trim().slice(0, 500);
    const note = `[${question.saveKey || question.questionKey}] unparsed answer: ${raw}`;
    answers.qualification_notes = [state.answers.qualification_notes || '', note]
      .filter(Boolean)
      .join('\n')
      .slice(0, 5000);
  }
  const lowerValue = finalParsedValue.toLocaleLowerCase();
  const isPause =
    question.saveKey === 'q_permission' &&
    ['no', 'مش دلوقتي'].includes(lowerValue);

  if (isPause) {
    const nextState: ConversationState = {
      ...state,
      answers,
      currentStage: 'paused',
      currentQuestionKey: '',
      retryCount: 0,
      status: 'paused',
      stateVersion: state.stateVersion + 1,
    };
    return {
      action: 'pause',
      replyKey: 'paused_ack',
      text: messageText(config, 'paused_ack', language, state),
      messageKind: 'text',
      stageBefore,
      stageAfter: 'paused',
      questionKey: question.questionKey,
      saveKey: question.saveKey,
      parsedValue: finalParsedValue,
      ...(parseSource ? { parseSource } : {}),
      ...(needsAsyncAi ? { needsAsyncAi } : {}),
      outboxEvents: [
        {
          eventType: 'qualification_paused',
          payload: { reason: 'declined_permission', raw: incomingText || messageOptionId || '' },
        },
      ],
      nextState,
    };
  }

  const nextQuestion = nextQuestionAfter(config, question, finalParsedValue);
  const collected = saveAnswer({ ...state, answers: {} }, question, finalParsedValue);
  const commonEvents: ReplyDecision['outboxEvents'] = [
    {
      eventType: 'qualification_answer_saved',
      payload: {
        questionKey: question.questionKey,
        saveKey: question.saveKey,
        parsedValue: finalParsedValue,
        collected,
        raw: incomingText || messageOptionId || '',
        parseSource,
      },
    },
  ];
  if (needsAsyncAi) {
    commonEvents.push({
      eventType: 'shadow_ai_refinement_requested',
      payload: {
        stage: state.currentStage,
        questionKey: question.questionKey,
        raw: String(incomingText || messageOptionId || ''),
        provisionalValue: finalParsedValue,
      },
    });
  }

  if (!nextQuestion) {
    const nextState: ConversationState = {
      ...state,
      answers,
      currentStage: 'qualified',
      currentQuestionKey: '',
      retryCount: 0,
      status: 'qualified',
      stateVersion: state.stateVersion + 1,
    };
    return {
      action: 'complete',
      replyKey: 'qualified_closing',
      text: messageText(config, 'qualified_closing', language, state),
      messageKind: 'text',
      stageBefore,
      stageAfter: 'qualified',
      questionKey: question.questionKey,
      saveKey: question.saveKey,
      parsedValue: finalParsedValue,
      ...(parseSource ? { parseSource } : {}),
      ...(needsAsyncAi ? { needsAsyncAi } : {}),
      outboxEvents: [
        ...commonEvents,
        {
          eventType: 'qualification_completed',
          payload: {
            qualification: qualificationPayload(answers),
            transcriptNote: 'completed via conversation edge integration-safe runtime',
          },
        },
      ],
      nextState,
    };
  }

  const nextState: ConversationState = {
    ...state,
    answers,
    currentStage: nextQuestion.stageKey,
    currentQuestionKey: nextQuestion.questionKey,
    retryCount: 0,
    status: nextQuestion.stageKey === 'awaiting_permission' ? state.status : 'in_qualification',
    stateVersion: state.stateVersion + 1,
  };
  return {
    action: 'reply',
    replyKey: nextQuestion.questionKey,
    ...questionReply(nextState, nextQuestion, language),
    stageBefore,
    stageAfter: nextQuestion.stageKey,
    questionKey: question.questionKey,
    saveKey: question.saveKey,
    parsedValue: finalParsedValue,
    ...(parseSource ? { parseSource } : {}),
    ...(needsAsyncAi ? { needsAsyncAi } : {}),
    outboxEvents: commonEvents,
    nextState,
  };
}
