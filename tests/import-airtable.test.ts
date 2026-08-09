import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAirtableExport, parseArgs as parseImportArgs } from '../scripts/import-airtable.js';
import { parseArgs as parseReconciliationArgs } from '../scripts/reconcile-airtable.js';

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

  it('fails Airtable import CLI parsing on ambiguous operator arguments before loading source files', () => {
    expect(parseImportArgs(['--input=tests/fixtures/airtable-export'])).toEqual({
      inputDir: 'tests/fixtures/airtable-export',
      apply: false,
    });
    expect(parseImportArgs(['--input=tests/fixtures/airtable-export', '--apply'])).toEqual({
      inputDir: 'tests/fixtures/airtable-export',
      apply: true,
    });

    expect(() => parseImportArgs([])).toThrow(/Usage: npm run import:airtable/);
    expect(() => parseImportArgs(['tests/fixtures/airtable-export'])).toThrow(/Unknown Airtable import argument/);
    expect(() => parseImportArgs(['--input=tests/fixtures/airtable-export', '--input=other'])).toThrow(/Duplicate Airtable import argument: --input/);
    expect(() => parseImportArgs(['--input=tests/fixtures/airtable-export', '--apply', '--apply'])).toThrow(/Duplicate Airtable import argument: --apply/);
    expect(() => parseImportArgs(['--input='])).toThrow(/Missing Airtable import argument: --input/);
    expect(() => parseImportArgs(['--input=tests/fixtures\n/airtable-export'])).toThrow(/Invalid Airtable import argument: --input/);
    expect(() => parseImportArgs(['--input=tests/fixtures/airtable-export', '--apply=true'])).toThrow(/Unknown Airtable import argument/);
  });

  it('fails Airtable reconciliation CLI parsing on ambiguous operator arguments before querying PostgreSQL', () => {
    const importRunId = '11111111-1111-4111-8111-111111111111';

    expect(parseReconciliationArgs([])).toEqual({ recordResults: false });
    expect(parseReconciliationArgs(['--record-results'])).toEqual({ recordResults: true });
    expect(parseReconciliationArgs([`--import-run-id=${importRunId}`, '--record-results'])).toEqual({
      importRunId,
      recordResults: true,
    });

    expect(() => parseReconciliationArgs(['--record-results', '--record-results'])).toThrow(/Duplicate Airtable reconciliation argument: --record-results/);
    expect(() => parseReconciliationArgs([`--import-run-id=${importRunId}`, '--import-run-id=22222222-2222-4222-8222-222222222222'])).toThrow(/Duplicate Airtable reconciliation argument: --import-run-id/);
    expect(() => parseReconciliationArgs(['--import-run-id=not-a-uuid'])).toThrow(/Invalid Airtable reconciliation argument: --import-run-id/);
    expect(() => parseReconciliationArgs(['--import-run-id='])).toThrow(/Missing Airtable reconciliation argument: --import-run-id/);
    expect(() => parseReconciliationArgs([`--import-run-id=${importRunId}\n`])).toThrow(/Invalid Airtable reconciliation argument: --import-run-id/);
    expect(() => parseReconciliationArgs(['--record-results=true'])).toThrow(/Unknown Airtable reconciliation argument/);
    expect(() => parseReconciliationArgs(['--unknown=1'])).toThrow(/Unknown Airtable reconciliation argument/);
  });
});
