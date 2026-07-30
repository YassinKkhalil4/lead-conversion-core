export type Language = 'Arabic' | 'English';
export type QuestionType = 'Buttons' | 'List' | 'Free Text';
export type ParserHint = 'none' | 'egp_amount' | 'egp_range' | string;
export type ConversationEngine = 'legacy' | 'edge';
export type StateAuthority = 'legacy' | 'edge';

export interface CompiledOption {
  id: string;
  value: string;
  order: number;
  labels: Record<Language, string>;
}

export interface CompiledQuestion {
  recordId: string;
  questionKey: string;
  stageKey: string;
  saveKey: string;
  order: number;
  type: QuestionType;
  parserHint: ParserHint;
  texts: Record<Language, string>;
  options: CompiledOption[];
}

export interface CompiledMessage {
  key: string;
  texts: Record<Language, string>;
}

export interface CompiledConfig {
  version: string;
  clientRecordId: string | null;
  industry: string;
  questions: CompiledQuestion[];
  messages: Record<string, CompiledMessage>;
  createdAt: string;
}

export interface ConversationState {
  conversationId?: string;
  clientRecordId: string;
  clientId: string;
  phoneNormalized: string;
  leadRecordId: string;
  leadId: string;
  leadName: string;
  companyName: string;
  projectName: string;
  projectRecordId: string;
  preferredLanguage: Language | '';
  currentStage: string;
  currentQuestionKey: string;
  answers: Record<string, string>;
  retryCount: number;
  status: string;
  humanTakeover: boolean;
  stopFollowUp: boolean;
  closedStatus: string;
  appointmentStatus: string;
  assignedSalespersonRecordId: string;
  assignedSalespersonPhone: string;
  lastInboundAt: string;
  conversationWindowExpiresAt: string;
  conversationEngine: ConversationEngine;
  stateAuthority: StateAuthority;
  configVersion: string;
  stateVersion: number;
}

export interface InteractiveOption {
  id: string;
  label: string;
}

export interface ReplyDecision {
  action: 'reply' | 'pause' | 'complete' | 'handoff' | 'fallback' | 'no_reply';
  replyKey: string;
  text: string;
  messageKind: 'text' | 'buttons' | 'list';
  interactiveOptions?: InteractiveOption[];
  stageBefore: string;
  stageAfter: string;
  questionKey?: string;
  saveKey?: string;
  parsedValue?: string;
  parseSource?: 'option_id' | 'index' | 'value' | 'label' | 'parser' | 'free_text' | 'raw_fallback';
  needsAsyncAi?: boolean;
  suppressionReason?: string;
  outboxEvents: Array<{ eventType: string; payload: Record<string, unknown> }>;
  nextState: ConversationState;
}

export interface ShadowEvaluateInput {
  eventId: string;
  metaMessageId: string;
  clientRecordId: string;
  clientId?: string | undefined;
  phoneNormalized: string;
  leadRecordId: string;
  leadId?: string | undefined;
  leadName?: string | undefined;
  companyName?: string | undefined;
  projectName?: string | undefined;
  projectRecordId?: string | undefined;
  messageText?: string | undefined;
  messageOptionId?: string | undefined;
  preferredLanguage?: Language | '' | undefined;
  currentStage?: string | undefined;
  currentQuestionKey?: string | undefined;
  answers?: Record<string, string> | undefined;
  retryCount?: number | undefined;
  status?: string | undefined;
  humanTakeover?: boolean | undefined;
  stopFollowUp?: boolean | undefined;
  closedStatus?: string | undefined;
  appointmentStatus?: string | undefined;
  assignedSalespersonRecordId?: string | undefined;
  assignedSalespersonPhone?: string | undefined;
  lastInboundAt?: string | undefined;
  receivedAt?: string | undefined;
  stateAuthority?: StateAuthority | undefined;
  legacyExpected?: Record<string, unknown> | undefined;
}

export interface EdgeEventEnvelopeV1 {
  schema: 'edge.event.v1';
  outboxId: string;
  eventType: string;
  idempotencyKey: string;
  occurredAt: string;
  aggregate: {
    conversationId: string;
    clientRecordId: string;
    leadRecordId: string;
    phoneNormalized: string;
  };
  payload: Record<string, unknown>;
}
