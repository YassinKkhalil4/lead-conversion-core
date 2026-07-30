import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let configModule: typeof import('../src/configuration/versioned-config-service.js');
let airtableConfigSource: typeof import('../src/configuration/airtable-config-source.js');

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function writeAirtableConfigExport(dir: string, seedPath: string): void {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    questions: Array<{ id: string; fields: Record<string, unknown> }>;
    options: Array<{ id: string; fields: Record<string, unknown> }>;
    messages: Array<{ id: string; fields: Record<string, unknown> }>;
  };
  writeFileSync(join(dir, 'Questions.json'), JSON.stringify({ records: seed.questions }, null, 2));
  writeFileSync(join(dir, 'Conversation Messages.json'), JSON.stringify({ records: seed.messages }, null, 2));
  const headers = ['id', 'Option Key', 'Value', 'Order', 'Arabic', 'English', 'Active', 'Question'];
  const optionRows = seed.options.map((record) => [
    record.id,
    record.fields['Option Key'],
    record.fields.Value,
    record.fields.Order,
    record.fields.Arabic,
    record.fields.English,
    record.fields.Active,
    record.fields.Question,
  ]);
  writeFileSync(join(dir, 'Question Options.csv'), [headers.join(','), ...optionRows.map((row) => row.map(csvCell).join(','))].join('\n'));
}

describe('versioned configuration validation', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:1/unused';
    process.env.EDGE_SHARED_SECRET ||= 'test_shared_secret_123456';
    process.env.EDGE_INTERNAL_SECRET ||= 'test_internal_secret_123456';
    configModule = await import('../src/configuration/versioned-config-service.js');
    airtableConfigSource = await import('../src/configuration/airtable-config-source.js');
  });

  afterAll(async () => {
    const db = await import('../src/db/pool.js');
    await db.closePool();
  });

  it('rejects configuration sources with no active questions', async () => {
    const service = new configModule.VersionedConfigService();
    await expect(
      service.loadAndCompile(join(process.cwd(), 'tests/fixtures/config-invalid/no-active-questions.json'), null),
    ).rejects.toThrow(/No active questions/);
  });

  it('reports deterministic question and message diffs', () => {
    const diff = configModule.diffCompiledConfigs(
      {
        version: 'from',
        clientRecordId: null,
        industry: 'real_estate',
        createdAt: '2026-07-30T00:00:00.000Z',
        questions: [
          {
            recordId: 'recOld',
            questionKey: 'q_old',
            stageKey: 'old',
            saveKey: 'q_old',
            order: 1,
            type: 'Free Text',
            parserHint: 'none',
            texts: { Arabic: 'قديم', English: 'Old' },
            options: [],
          },
        ],
        messages: {
          old_message: { key: 'old_message', texts: { Arabic: 'قديم', English: 'Old' } },
        },
      },
      {
        version: 'to',
        clientRecordId: null,
        industry: 'real_estate',
        createdAt: '2026-07-30T00:00:00.000Z',
        questions: [
          {
            recordId: 'recNew',
            questionKey: 'q_new',
            stageKey: 'new',
            saveKey: 'q_new',
            order: 1,
            type: 'Free Text',
            parserHint: 'none',
            texts: { Arabic: 'جديد', English: 'New' },
            options: [],
          },
        ],
        messages: {
          new_message: { key: 'new_message', texts: { Arabic: 'جديد', English: 'New' } },
        },
      },
    );

    expect(diff).toEqual({
      fromVersion: 'from',
      toVersion: 'to',
      addedQuestions: ['q_new'],
      removedQuestions: ['q_old'],
      addedMessages: ['new_message'],
      removedMessages: ['old_message'],
      questionCountDelta: 0,
      messageCountDelta: 0,
    });
  });

  it('compiles Airtable configuration exports to the same deterministic version as the seed source', async () => {
    const service = new configModule.VersionedConfigService();
    const seedPath = join(process.cwd(), 'config/seed-real-estate.json');
    const dir = mkdtempSync(join(tmpdir(), 'lead-core-airtable-config.'));
    try {
      writeAirtableConfigExport(dir, seedPath);
      const seedConfig = await service.loadAndCompile(seedPath, null);
      const loaded = await service.loadAndCompileAirtableExport(dir, null);

      expect(loaded.config.version).toBe(seedConfig.version);
      expect(loaded.summary).toMatchObject({
        totalRecords: 38,
        validRecords: 38,
        rejectedRecords: 0,
        missingTables: [],
      });

      const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/config.ts', 'validate', `--airtable-export=${dir}`], {
        env: process.env,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(output) as { ok: boolean; version: string; sourceSummary: { validRecords: number } };
      expect(parsed.ok).toBe(true);
      expect(parsed.version).toBe(seedConfig.version);
      expect(parsed.sourceSummary.validRecords).toBe(38);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports actionable rejects for malformed Airtable configuration records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lead-core-airtable-config-bad.'));
    try {
      writeFileSync(join(dir, 'Questions.json'), JSON.stringify({
        records: [
          { id: 'recQuestionDuplicate', fields: { 'Question Key': 'q_one', 'Stage Key': 'one', 'Question Type': 'Buttons', Order: 1, Active: true, English: 'One' } },
          { id: 'recQuestionDuplicate', fields: { 'Question Key': 'q_two', 'Stage Key': 'two', 'Question Type': 'Buttons', Order: 2, Active: true, English: 'Two' } },
        ],
      }, null, 2));
      writeFileSync(join(dir, 'Question Options.json'), JSON.stringify({
        records: [
          { id: 'recOptionMissingQuestion', fields: { 'Option Key': 'yes', Value: 'yes', Order: 1, Active: true, English: 'Yes' } },
        ],
      }, null, 2));
      writeFileSync(join(dir, 'Conversation Messages.json'), JSON.stringify({
        records: [
          { id: 'recMessageBad', fields: { 'Message Key': 'fallback', Active: true } },
        ],
      }, null, 2));

      const loaded = await airtableConfigSource.loadAirtableConfigExport(dir, null);
      expect(loaded.summary.tables.Questions?.rejectedReasons.duplicate_airtable_record_id).toBe(2);
      expect(loaded.summary.tables['Question Options']?.rejectedReasons['missing_required_field:Question']).toBe(1);
      expect(loaded.summary.tables['Conversation Messages']?.rejectedReasons.missing_message_text).toBe(1);
      await expect(new configModule.VersionedConfigService().loadAndCompileAirtableExport(dir, null)).rejects.toThrow(/airtable_config_export_invalid/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
