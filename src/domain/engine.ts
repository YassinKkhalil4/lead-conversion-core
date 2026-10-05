import { industryHooks } from './industries/index.js';
import { configLanguages, defaultLanguage, localized } from './language.js';
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

/**
 * The stage a lead sits on between being shown slots and tapping one.
 *
 * It deliberately is not `appointment_slot_selection` (that stage still routes
 * to the legacy handler below), nor `qualified`/`sales_handoff` (those answer
 * `already_handed_off` and would swallow the tap).
 */
export const APPOINTMENT_SLOT_STAGE = 'awaiting_appointment_slot';

/** `appt:<appointmentOfferId>:<appointmentSlotId>`, 78 characters. */
const SLOT_OPTION_PATTERN = /^appt:([0-9a-f-]{36}):([0-9a-f-]{36})$/i;

export function parseSlotOption(value: string): { appointmentOfferId: string; appointmentSlotId: string } | null {
  const match = SLOT_OPTION_PATTERN.exec(value.trim());
  if (!match || !match[1] || !match[2]) return null;
  return { appointmentOfferId: match[1], appointmentSlotId: match[2] };
}

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
  return renderTemplate(localized(message.texts, language), templateVars(state), language);
}

function questionReply(
  state: ConversationState,
  question: CompiledQuestion,
  language: Language,
): Pick<ReplyDecision, 'text' | 'messageKind' | 'interactiveOptions'> {
  const text = renderTemplate(localized(question.texts, language), templateVars(state), language);
  const options: InteractiveOption[] = question.options.map((option) => ({
    id: option.id,
    label: localized(option.labels, language),
  }));
  const messageKind = options.length === 0 ? 'text' : question.type === 'List' || options.length > 3 ? 'list' : 'buttons';
  return {
    text,
    messageKind,
    ...(options.length > 0 ? { interactiveOptions: options } : {}),
  };
}

const LANGUAGE_BUTTONS: Record<Language, { id: string; label: string; aliases: string[] }> = {
  English: {
    id: 'lang_en',
    label: '🇺🇸 English',
    aliases: ['lang_en', 'english', 'en', 'انجليزي', 'انجليزى', 'الانجليزية', '🇺🇸 english'],
  },
  Arabic: {
    id: 'lang_ar',
    label: '🇪🇬 العربية',
    aliases: ['lang_ar', 'arabic', 'ar', 'العربية', 'عربي', 'عربى', 'مصري', 'مصرى', '🇪🇬 العربية'],
  },
  Spanish: {
    id: 'lang_es',
    label: '🇪🇸 Español',
    aliases: ['lang_es', 'spanish', 'es', 'español', 'espanol', 'castellano', 'castellà', '🇪🇸 español'],
  },
  Catalan: {
    id: 'lang_ca',
    label: 'Català',
    aliases: ['lang_ca', 'catalan', 'ca', 'català', 'catala', 'catalán'],
  },
};

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
    text: messageText(config, 'language_selection', defaultLanguage(config), state),
    messageKind: 'buttons',
    interactiveOptions: configLanguages(config).map((language) => ({
      id: LANGUAGE_BUTTONS[language].id,
      label: LANGUAGE_BUTTONS[language].label,
    })),
    stageBefore: state.currentStage,
    stageAfter: 'language_selection',
    outboxEvents: [],
    nextState,
  };
}

/**
 * The language a guest picked, among the ones this tenant offers. A number
 * picks by position in the button order, so for real estate 1 is English and
 * 2 is Arabic, as it always was.
 */
function parseLanguage(input: { text?: string; optionId?: string }, allowed: readonly Language[]): Language | null {
  const raw = String(input.optionId || input.text || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, '');
  for (const [index, language] of allowed.entries()) {
    if (raw === String(index + 1) || LANGUAGE_BUTTONS[language].aliases.includes(raw)) return language;
  }
  return null;
}

/**
 * Why the engine will not reply to this state, or null if it will.
 *
 * Exported so a caller that creates a conversation can tell straight away that
 * the new row is born silent, instead of that only surfacing when an inbound
 * turn is later dropped.
 */
export function suppressionReason(state: ConversationState): string | null {
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

export function evaluateConversation(input: EngineInput): ReplyDecision {
  const { config, messageText: incomingText, messageOptionId } = input;
  const state = { ...input.state, answers: { ...input.state.answers } };
  const stageBefore = state.currentStage;
  const hooks = industryHooks(config.industry);
  const fallbackLanguage = defaultLanguage(config);

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

  if (state.currentStage === APPOINTMENT_SLOT_STAGE) {
    const language: Language = state.preferredLanguage || fallbackLanguage;
    const selected = parseSlotOption(String(messageOptionId || incomingText || ''));
    if (selected) {
      return {
        action: 'reply',
        replyKey: 'appointment_slot_selected',
        text: '',
        messageKind: 'text',
        stageBefore,
        stageAfter: state.currentStage,
        outboxEvents: [{ eventType: 'appointment_slot_selected', payload: { ...selected } }],
        nextState: { ...state, retryCount: 0, stateVersion: state.stateVersion + 1 },
      };
    }
    if (state.retryCount === 0) {
      return {
        action: 'reply',
        replyKey: 'appointment_slot_reprompt',
        text: messageText(config, 'clarify_invalid', language, state),
        messageKind: 'text',
        stageBefore,
        stageAfter: state.currentStage,
        outboxEvents: [
          {
            eventType: 'appointment_slot_reply_unparsed',
            payload: { raw: String(incomingText || messageOptionId || '').slice(0, 200) },
          },
        ],
        nextState: { ...state, retryCount: 1, stateVersion: state.stateVersion + 1 },
      };
    }
    // Re-prompted once already. Never loop: hand the lead to the closing
    // message and let a human pick the visit up from there.
    return {
      action: 'complete',
      replyKey: 'qualified_closing',
      text: messageText(config, 'qualified_closing', language, state),
      messageKind: 'text',
      stageBefore,
      stageAfter: 'qualified',
      outboxEvents: [
        {
          eventType: 'appointment_offer_abandoned',
          payload: { reason: 'slot_reply_unparsed_after_retry' },
        },
      ],
      nextState: {
        ...state,
        currentStage: 'qualified',
        currentQuestionKey: '',
        retryCount: 0,
        status: 'qualified',
        stateVersion: state.stateVersion + 1,
      },
    };
  }

  if (['qualified', 'sales_handoff'].includes(state.currentStage)) {
    const language: Language = state.preferredLanguage || fallbackLanguage;
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
    }, configLanguages(config));
    if (!selected && state.retryCount === 0) {
      const nextState = { ...state, retryCount: 1, stateVersion: state.stateVersion + 1 };
      return { ...languageReply(config, nextState), stageBefore, nextState };
    }
    const language: Language = selected || fallbackLanguage;
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
    const language: Language = state.preferredLanguage || fallbackLanguage;
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
    const language: Language = state.preferredLanguage || fallbackLanguage;
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

  const language: Language = state.preferredLanguage || fallbackLanguage;
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
  const answers = hooks.saveAnswer(state, question, finalParsedValue);
  if (parseSource === 'raw_fallback') {
    const raw = String(incomingText || messageOptionId || '').trim().slice(0, 500);
    const note = `[${question.saveKey || question.questionKey}] unparsed answer: ${raw}`;
    answers.qualification_notes = [state.answers.qualification_notes || '', note]
      .filter(Boolean)
      .join('\n')
      .slice(0, 5000);
  }
  const lowerValue = finalParsedValue.toLocaleLowerCase();
  const isPause = hooks.isPauseAnswer(question, lowerValue);

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

  const nextQuestion = hooks.nextQuestionAfter(config, question, finalParsedValue);
  const collected = hooks.saveAnswer({ ...state, answers: {} }, question, finalParsedValue);
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
    const completionEvents: ReplyDecision['outboxEvents'] = [
      ...commonEvents,
      {
        eventType: 'qualification_completed',
        payload: {
          qualification: hooks.qualificationPayload(answers),
          transcriptNote: 'completed via conversation edge integration-safe runtime',
        },
      },
    ];

    // A lead who accepts a site visit is fully qualified, so scoring and
    // routing still run off `qualification_completed`. Instead of closing the
    // conversation, park them on the slot stage; the caller owns slot
    // generation and decides whether an offer can actually be sent.
    if (hooks.offersAppointment(question, finalParsedValue)) {
      const offerState: ConversationState = {
        ...state,
        answers,
        currentStage: APPOINTMENT_SLOT_STAGE,
        currentQuestionKey: '',
        retryCount: 0,
        status: 'qualified',
        stateVersion: state.stateVersion + 1,
      };
      return {
        action: 'reply',
        replyKey: 'appointment_slot_offer',
        text: '',
        messageKind: 'list',
        stageBefore,
        stageAfter: APPOINTMENT_SLOT_STAGE,
        questionKey: question.questionKey,
        saveKey: question.saveKey,
        parsedValue: finalParsedValue,
        ...(parseSource ? { parseSource } : {}),
        ...(needsAsyncAi ? { needsAsyncAi } : {}),
        outboxEvents: [
          ...completionEvents,
          { eventType: 'appointment_slot_offer_requested', payload: { siteVisit: finalParsedValue } },
        ],
        nextState: offerState,
      };
    }

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
      outboxEvents: completionEvents,
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
