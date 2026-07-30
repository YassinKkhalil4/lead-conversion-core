import { describe, expect, it } from 'vitest';
import { loadAirtableExport } from '../scripts/import-airtable.js';

describe('airtable import dry run', () => {
  it('loads json and csv exports, validates minimum required fields, and reports missing tables', async () => {
    const { summary } = await loadAirtableExport('tests/fixtures/airtable-export');
    expect(summary.totalRecords).toBe(4);
    expect(summary.validRecords).toBe(4);
    expect(summary.rejectedRecords).toBe(0);
    expect(summary.tables.Clients?.valid).toBe(1);
    expect(summary.tables.Projects?.valid).toBe(1);
    expect(summary.tables.Salespeople?.valid).toBe(1);
    expect(summary.missingTables).toContain('Messages');
  });
});
