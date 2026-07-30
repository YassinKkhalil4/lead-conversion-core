import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { AirtableRecord, CompileInput } from '../domain/compiler.js';
import type { QuestionType } from '../domain/types.js';

type AirtableFields = Record<string, unknown>;

interface LoadedRecord extends AirtableRecord {
  contentHash: string;
}

interface RejectedConfigRecord {
  tableName: string;
  recordId: string;
  reason: string;
  fields: AirtableFields;
}

export interface AirtableConfigExportSummary {
  inputDir: string;
  tables: Record<string, {
    total: number;
    valid: number;
    rejected: number;
    missing: boolean;
    rejectedReasons: Record<string, number>;
  }>;
  totalRecords: number;
  validRecords: number;
  rejectedRecords: number;
  missingTables: string[];
  rejected: RejectedConfigRecord[];
}

export interface AirtableConfigExport {
  input: CompileInput;
  summary: AirtableConfigExportSummary;
}

const CONFIG_TABLES = ['Questions', 'Question Options', 'Conversation Messages'] as const;
const QUESTION_TYPES = new Set<QuestionType>(['Buttons', 'List', 'Free Text']);

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

function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeTableName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(',');
  return String(value ?? '').trim();
}

function boolValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLocaleLowerCase();
  if (['true', 'yes', '1', 'checked'].includes(text)) return true;
  if (['false', 'no', '0', 'unchecked'].includes(text)) return false;
  return null;
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(text: string): AirtableFields[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);

  const [headers = [], ...body] = rows.filter((candidate) => candidate.some((value) => value.trim() !== ''));
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ''])));
}

function coerceJsonRecords(parsed: unknown, tableName: string): AirtableFields[] {
  const candidate =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { records?: unknown[] }).records)
        ? (parsed as { records: unknown[] }).records
        : Array.isArray((parsed as Record<string, unknown>)[tableName])
          ? (parsed as Record<string, unknown>)[tableName] as unknown[]
          : [];

  return candidate.map((record) => {
    const value = record as { id?: unknown; fields?: unknown };
    if (value.fields && typeof value.fields === 'object') {
      return {
        id: String(value.id ?? ''),
        ...(value.fields as AirtableFields),
      };
    }
    return record as AirtableFields;
  });
}

async function loadRows(inputDir: string, tableName: string): Promise<AirtableFields[]> {
  const files = await readdir(inputDir);
  const wanted = normalizeTableName(tableName);
  const file = files.find((candidate) => {
    const extension = extname(candidate).toLocaleLowerCase();
    if (!['.json', '.csv'].includes(extension)) return false;
    return normalizeTableName(candidate.slice(0, -extension.length)) === wanted;
  });
  if (!file) return [];
  const text = await readFile(join(inputDir, file), 'utf8');
  return extname(file).toLocaleLowerCase() === '.csv'
    ? parseCsv(text)
    : coerceJsonRecords(JSON.parse(text), tableName);
}

function normalizeFields(tableName: string, fields: AirtableFields): { fields: AirtableFields | null; reason?: string } {
  const normalized: AirtableFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id' || key === 'Record ID') continue;
    normalized[key] = value;
  }

  const active = boolValue(normalized.Active);
  if (active === null) return { fields: null, reason: 'invalid_or_missing_active' };
  normalized.Active = active;

  if ('Client' in normalized) normalized.Client = arrayValue(normalized.Client);
  if ('Question' in normalized) normalized.Question = arrayValue(normalized.Question);

  if (tableName === 'Questions') {
    for (const key of ['Question Key', 'Stage Key', 'Question Type', 'Order']) {
      if (!stringValue(normalized[key])) return { fields: null, reason: `missing_required_field:${key}` };
    }
    if (!stringValue(normalized.English) && !stringValue(normalized.Arabic)) return { fields: null, reason: 'missing_question_text' };
    const order = parseNumber(normalized.Order);
    if (order === null) return { fields: null, reason: 'invalid_number:Order' };
    normalized.Order = order;
    if (!QUESTION_TYPES.has(stringValue(normalized['Question Type']) as QuestionType)) return { fields: null, reason: 'invalid_question_type' };
  }

  if (tableName === 'Question Options') {
    for (const key of ['Option Key', 'Value', 'Question', 'Order']) {
      if (!stringValue(normalized[key])) return { fields: null, reason: `missing_required_field:${key}` };
    }
    if (!stringValue(normalized.English) && !stringValue(normalized.Arabic)) return { fields: null, reason: 'missing_option_text' };
    const order = parseNumber(normalized.Order);
    if (order === null) return { fields: null, reason: 'invalid_number:Order' };
    normalized.Order = order;
  }

  if (tableName === 'Conversation Messages') {
    if (!stringValue(normalized['Message Key'])) return { fields: null, reason: 'missing_required_field:Message Key' };
    if (!stringValue(normalized.English) && !stringValue(normalized.Arabic)) return { fields: null, reason: 'missing_message_text' };
  }

  return { fields: normalized };
}

function reject(summary: AirtableConfigExportSummary, tableName: string, recordId: string, reason: string, fields: AirtableFields): void {
  summary.rejected.push({ tableName, recordId, reason, fields });
  const table = summary.tables[tableName];
  if (table) {
    table.rejected += 1;
    table.rejectedReasons[reason] = (table.rejectedReasons[reason] || 0) + 1;
  }
  summary.rejectedRecords += 1;
}

export async function loadAirtableConfigExport(inputDir: string, clientRecordId: string | null = null): Promise<AirtableConfigExport> {
  const summary: AirtableConfigExportSummary = {
    inputDir,
    tables: {},
    totalRecords: 0,
    validRecords: 0,
    rejectedRecords: 0,
    missingTables: [],
    rejected: [],
  };
  const loaded: Record<string, LoadedRecord[]> = {};

  for (const tableName of CONFIG_TABLES) {
    const rows = await loadRows(inputDir, tableName);
    summary.tables[tableName] = {
      total: rows.length,
      valid: 0,
      rejected: 0,
      missing: rows.length === 0,
      rejectedReasons: {},
    };
    summary.totalRecords += rows.length;
    if (rows.length === 0) summary.missingTables.push(tableName);

    const ids = rows.reduce<Record<string, number>>((acc, row) => {
      const id = stringValue(row.id) || stringValue(row['Record ID']);
      if (id) acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});

    loaded[tableName] = [];
    for (const row of rows) {
      const id = stringValue(row.id) || stringValue(row['Record ID']);
      if (!id) {
        reject(summary, tableName, '', 'missing_airtable_record_id', row);
        continue;
      }
      if ((ids[id] || 0) > 1) {
        reject(summary, tableName, id, 'duplicate_airtable_record_id', row);
        continue;
      }
      const normalized = normalizeFields(tableName, row);
      if (!normalized.fields) {
        reject(summary, tableName, id, normalized.reason || 'invalid_record', row);
        continue;
      }
      const record = { id, fields: normalized.fields, contentHash: contentHash(normalized.fields) };
      loaded[tableName].push(record);
      summary.tables[tableName].valid += 1;
      summary.validRecords += 1;
    }
  }

  return {
    input: {
      clientRecordId,
      industry: 'real_estate',
      questions: loaded.Questions || [],
      options: loaded['Question Options'] || [],
      messages: loaded['Conversation Messages'] || [],
    },
    summary,
  };
}
