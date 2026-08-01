import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAirtableExport } from '../scripts/import-airtable.js';

describe('airtable import dry run', () => {
  it('loads json and csv exports, validates minimum required fields, and reports missing tables', async () => {
    const { summary } = await loadAirtableExport('tests/fixtures/airtable-export');
    expect(summary.totalRecords).toBe(10);
    expect(summary.validRecords).toBe(10);
    expect(summary.rejectedRecords).toBe(0);
    expect(summary.manifest.present).toBe(true);
    expect(summary.manifest.errors).toContain('manifest_missing_table:Questions');
    expect(summary.tables.Clients?.valid).toBe(1);
    expect(summary.tables.Projects?.valid).toBe(1);
    expect(summary.tables.Salespeople?.valid).toBe(1);
    expect(summary.tables.Messages?.valid).toBe(1);
    expect(summary.tables.Events?.valid).toBe(1);
    expect(summary.missingTables).toContain('Questions');
  });

  it('rejects records with missing or duplicate Airtable record IDs and invalid phones', async () => {
    const { summary } = await loadAirtableExport('tests/fixtures/airtable-export-malformed');
    expect(summary.tables.Clients?.rejectedReasons.missing_airtable_record_id).toBe(1);
    expect(summary.tables.Clients?.rejectedReasons.duplicate_airtable_record_id).toBe(2);
    expect(summary.tables.Salespeople?.rejectedReasons.invalid_phone).toBe(1);
  });

  it('reports duplicate phone and email collisions in source rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lead-core-airtable-collisions.'));
    writeFileSync(join(dir, 'Leads.json'), JSON.stringify([
      { id: 'recLEADCOLLIDE1', fields: { 'Phone Raw': '01000000002', Email: 'Lead@Example.Invalid' } },
      { id: 'recLEADCOLLIDE2', fields: { 'Phone Normalized': '+201000000002', Email: 'lead@example.invalid' } },
    ]));
    writeFileSync(join(dir, 'Salespeople.csv'), [
      'id,Name,Phone,Email',
      'recSALECOLLIDE1,A,01000000003,sales@example.invalid',
      'recSALECOLLIDE2,B,+201000000003,Sales@Example.Invalid',
    ].join('\n'));

    const { summary } = await loadAirtableExport(dir);
    expect(summary.collisions).toEqual([
      {
        tableName: 'Leads',
        field: 'email',
        normalizedValue: 'lead@example.invalid',
        recordIds: ['recLEADCOLLIDE1', 'recLEADCOLLIDE2'],
        count: 2,
      },
      {
        tableName: 'Leads',
        field: 'phone',
        normalizedValue: '+201000000002',
        recordIds: ['recLEADCOLLIDE1', 'recLEADCOLLIDE2'],
        count: 2,
      },
      {
        tableName: 'Salespeople',
        field: 'email',
        normalizedValue: 'sales@example.invalid',
        recordIds: ['recSALECOLLIDE1', 'recSALECOLLIDE2'],
        count: 2,
      },
      {
        tableName: 'Salespeople',
        field: 'phone',
        normalizedValue: '+201000000003',
        recordIds: ['recSALECOLLIDE1', 'recSALECOLLIDE2'],
        count: 2,
      },
    ]);
  });
});
