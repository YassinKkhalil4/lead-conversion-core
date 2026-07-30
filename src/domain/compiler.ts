import { createHash } from 'node:crypto';
import type {
  CompiledConfig,
  CompiledMessage,
  CompiledOption,
  CompiledQuestion,
  Language,
  QuestionType,
} from './types.js';

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface CompileInput {
  clientRecordId?: string | null;
  industry?: string;
  questions: AirtableRecord[];
  options: AirtableRecord[];
  messages: AirtableRecord[];
  now?: string;
}

function linkedToClient(fields: Record<string, unknown>, clientRecordId: string): boolean {
  const clients = fields.Client;
  return Array.isArray(clients) && clients.includes(clientRecordId);
}

function isDefault(fields: Record<string, unknown>): boolean {
  return !Array.isArray(fields.Client) || fields.Client.length === 0;
}

function text(fields: Record<string, unknown>, language: Language): string {
  const other: Language = language === 'English' ? 'Arabic' : 'English';
  return String(fields[language] || fields[other] || '');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function compileConfig(input: CompileInput): CompiledConfig {
  const clientRecordId = input.clientRecordId || null;
  const activeQuestions = input.questions.filter((record) => record.fields.Active === true);
  const clientQuestions = clientRecordId
    ? activeQuestions.filter((record) => linkedToClient(record.fields, clientRecordId))
    : [];
  const scopedQuestions = (clientQuestions.length > 0
    ? clientQuestions
    : activeQuestions.filter((record) => isDefault(record.fields)))
    .slice()
    .sort((a, b) => Number(a.fields.Order || 0) - Number(b.fields.Order || 0));

  if (scopedQuestions.length === 0) throw new Error('No active questions found for config scope');

  const activeOptions = input.options.filter((record) => record.fields.Active === true);
  const questions: CompiledQuestion[] = scopedQuestions.map((record) => {
    const questionOptions: CompiledOption[] = activeOptions
      .filter((option) => {
        const linkedQuestions = option.fields.Question;
        return Array.isArray(linkedQuestions) && linkedQuestions.includes(record.id);
      })
      .sort((a, b) => Number(a.fields.Order || 0) - Number(b.fields.Order || 0))
      .map((option) => ({
        id: String(option.fields['Option Key'] || ''),
        value: String(option.fields.Value ?? ''),
        order: Number(option.fields.Order || 0),
        labels: {
          Arabic: text(option.fields, 'Arabic'),
          English: text(option.fields, 'English'),
        },
      }));

    return {
      recordId: record.id,
      questionKey: String(record.fields['Question Key'] || ''),
      stageKey: String(record.fields['Stage Key'] || ''),
      saveKey: String(record.fields['Saves To'] || record.fields['Question Key'] || ''),
      order: Number(record.fields.Order || 0),
      type: String(record.fields['Question Type'] || 'Free Text') as QuestionType,
      parserHint: String(record.fields['Parser Hint'] || 'none'),
      texts: {
        Arabic: text(record.fields, 'Arabic'),
        English: text(record.fields, 'English'),
      },
      options: questionOptions,
    };
  });

  const activeMessages = input.messages.filter((record) => record.fields.Active === true);
  const keys = [...new Set(activeMessages.map((record) => String(record.fields['Message Key'] || '')))].filter(Boolean);
  const messages: Record<string, CompiledMessage> = {};

  for (const key of keys) {
    const candidates = activeMessages.filter(
      (record) => String(record.fields['Message Key'] || '') === key,
    );
    const selected =
      (clientRecordId
        ? candidates.find((record) => linkedToClient(record.fields, clientRecordId))
        : undefined) || candidates.find((record) => isDefault(record.fields));
    if (!selected) continue;
    messages[key] = {
      key,
      texts: {
        Arabic: text(selected.fields, 'Arabic'),
        English: text(selected.fields, 'English'),
      },
    };
  }

  const withoutVersion = {
    clientRecordId,
    industry: input.industry || 'real_estate',
    questions,
    messages,
  };
  const version = createHash('sha256').update(stableStringify(withoutVersion)).digest('hex');

  return {
    version,
    clientRecordId,
    industry: input.industry || 'real_estate',
    questions,
    messages,
    createdAt: input.now || new Date().toISOString(),
  };
}
