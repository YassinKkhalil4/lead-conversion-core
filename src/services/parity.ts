import { isDeepStrictEqual } from 'node:util';
import type { ReplyDecision } from '../domain/types.js';

export interface ParityResult {
  status: 'not_compared' | 'match' | 'mismatch';
  differences: Record<string, { predicted: unknown; legacy: unknown }>;
}

export function compareParity(
  decision: ReplyDecision,
  legacyExpected?: Record<string, unknown>,
): ParityResult {
  if (!legacyExpected) return { status: 'not_compared', differences: {} };

  const predicted: Record<string, unknown> = {
    replyKey: decision.replyKey,
    stageAfter: decision.stageAfter,
    messageKind: decision.messageKind,
    parsedValue: decision.parsedValue ?? null,
    action: decision.action,
    text: decision.text,
    interactiveOptionIds: (decision.interactiveOptions || []).map((option) => option.id),
    interactiveOptionLabels: (decision.interactiveOptions || []).map((option) => option.label),
  };
  const differences: Record<string, { predicted: unknown; legacy: unknown }> = {};
  for (const [key, value] of Object.entries(predicted)) {
    if (key in legacyExpected && !isDeepStrictEqual(legacyExpected[key], value)) {
      differences[key] = { predicted: value, legacy: legacyExpected[key] };
    }
  }
  return {
    status: Object.keys(differences).length === 0 ? 'match' : 'mismatch',
    differences,
  };
}
