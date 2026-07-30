import { describe, expect, it } from 'vitest';
import { loadAirtableExport } from '../scripts/import-airtable.js';

describe('airtable import dry run', () => {
  it('loads json and csv exports, validates minimum required fields, and reports missing tables', async () => {
    const { summary } = await loadAirtableExport('tests/fixtures/airtable-export');
    expect(summary.totalRecords).toBe(4);
    expect(summary.validRecords).toBe(4);
    expect(summary.rejectedRecords).toBe(0);
    expect(summary.manifest.present).toBe(true);
    expect(summary.manifest.errors).toContain('manifest_missing_table:Messages');
    expect(summary.tables.Clients?.valid).toBe(1);
    expect(summary.tables.Projects?.valid).toBe(1);
    expect(summary.tables.Salespeople?.valid).toBe(1);
    expect(summary.missingTables).toContain('Messages');
  });

  it('rejects records with missing or duplicate Airtable record IDs and invalid phones', async () => {
    const { summary } = await loadAirtableExport('tests/fixtures/airtable-export-malformed');
    expect(summary.tables.Clients?.rejectedReasons.missing_airtable_record_id).toBe(1);
    expect(summary.tables.Clients?.rejectedReasons.duplicate_airtable_record_id).toBe(2);
    expect(summary.tables.Salespeople?.rejectedReasons.invalid_phone).toBe(1);
  });
});
