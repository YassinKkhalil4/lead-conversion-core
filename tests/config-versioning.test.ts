import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let configModule: typeof import('../src/configuration/versioned-config-service.js');

describe('versioned configuration validation', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:1/unused';
    process.env.EDGE_SHARED_SECRET ||= 'test_shared_secret_123456';
    process.env.EDGE_INTERNAL_SECRET ||= 'test_internal_secret_123456';
    configModule = await import('../src/configuration/versioned-config-service.js');
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
});
