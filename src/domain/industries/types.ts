import type { CompiledConfig, CompiledQuestion, ConversationState } from '../types.js';

/**
 * What differs between industries inside the conversation engine. The engine
 * owns the flow (language, retries, suppression, events); a hook owns what an
 * answer means for its industry.
 */
export interface IndustryHooks {
  /** Folds one parsed answer into the answers map. */
  saveAnswer(state: ConversationState, question: CompiledQuestion, value: string): Record<string, string>;
  /** The payload of `qualification_completed`, from the finished answers. */
  qualificationPayload(answers: Record<string, string>): Record<string, string>;
  /** The question after this one, or undefined when the conversation is complete. */
  nextQuestionAfter(config: CompiledConfig, question: CompiledQuestion, parsedValue: string): CompiledQuestion | undefined;
  /** True when this answer to the permission question means "not now". */
  isPauseAnswer(question: CompiledQuestion, lowerValue: string): boolean;
  /** True when finishing on this answer should offer appointment slots instead of closing. */
  offersAppointment(question: CompiledQuestion, value: string): boolean;
  /**
   * True when a message from someone whose conversation already completed
   * should start a new request. Real estate hands them to a person instead.
   */
  startsNewRequest(text: string): boolean;
}
