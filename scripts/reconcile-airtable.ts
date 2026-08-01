import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';

interface ReconciliationCheck {
  checkKey: string;
  status: 'pass' | 'warn' | 'fail';
  expectedCount: number | null;
  actualCount: number | null;
  details: Record<string, unknown>;
}

async function latestImportRunId(client: PoolClient): Promise<string> {
  const result = await client.query<{ import_run_id: string }>(
    `SELECT import_run_id
     FROM migration.import_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  const importRunId = result.rows[0]?.import_run_id;
  if (!importRunId) throw new Error('No migration import run exists');
  return importRunId;
}

async function scalar(client: PoolClient, sql: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count || 0);
}

async function mappedCountForRun(client: PoolClient, importRunId: string, sourceTable: string, targetTable: string): Promise<number> {
  return scalar(
    client,
    `SELECT count(*)::text AS count
     FROM migration.airtable_raw_records raw
     JOIN migration.entity_map mapped
       ON mapped.source_system='airtable'
      AND mapped.source_table=raw.table_name
      AND mapped.source_record_id=raw.record_id
      AND mapped.target_table=$3
     WHERE raw.import_run_id=$1
       AND raw.table_name=$2`,
    [importRunId, sourceTable, targetTable],
  );
}

export async function reconcileAirtableImport(input: {
  importRunId?: string;
  recordResults?: boolean;
} = {}): Promise<{ importRunId: string; checks: ReconciliationCheck[] }> {
  const [{ pool, closePool }] = await Promise.all([import('../src/db/pool.js')]);
  const client = await pool.connect();
  try {
    const importRunId = input.importRunId || await latestImportRunId(client);
    const checks: ReconciliationCheck[] = [];
    const rawByTable = await client.query<{ table_name: string; count: string }>(
      `SELECT table_name, count(*)::text AS count
       FROM migration.airtable_raw_records
       WHERE import_run_id=$1
       GROUP BY table_name
       ORDER BY table_name`,
      [importRunId],
    );
    const rawCounts = Object.fromEntries(rawByTable.rows.map((row) => [row.table_name, Number(row.count)]));

    const rejectedCount = await scalar(
      client,
      `SELECT count(*)::text AS count FROM migration.rejected_records WHERE import_run_id=$1`,
      [importRunId],
    );
    checks.push({
      checkKey: 'rejected_records',
      status: rejectedCount === 0 ? 'pass' : 'warn',
      expectedCount: 0,
      actualCount: rejectedCount,
      details: {},
    });

    const expectedClients = Number(rawCounts.Clients || 0);
    const mappedClients = await mappedCountForRun(client, importRunId, 'Clients', 'app.clients');
    checks.push({
      checkKey: 'clients_mapped',
      status: mappedClients === expectedClients ? 'pass' : 'fail',
      expectedCount: expectedClients,
      actualCount: mappedClients,
      details: {},
    });

    const expectedProjects = Number(rawCounts.Projects || 0);
    const mappedProjects = await mappedCountForRun(client, importRunId, 'Projects', 'app.projects');
    checks.push({
      checkKey: 'projects_mapped',
      status: mappedProjects === expectedProjects ? 'pass' : 'fail',
      expectedCount: expectedProjects,
      actualCount: mappedProjects,
      details: {},
    });

    const expectedSalespeople = Number(rawCounts.Salespeople || 0);
    const mappedSalespeople = await mappedCountForRun(client, importRunId, 'Salespeople', 'app.salespeople');
    checks.push({
      checkKey: 'salespeople_mapped',
      status: mappedSalespeople === expectedSalespeople ? 'pass' : 'fail',
      expectedCount: expectedSalespeople,
      actualCount: mappedSalespeople,
      details: {},
    });

    const expectedLeads = Number(rawCounts.Leads || 0);
    const mappedLeads = await mappedCountForRun(client, importRunId, 'Leads', 'app.leads');
    checks.push({
      checkKey: 'leads_mapped',
      status: mappedLeads === expectedLeads ? 'pass' : 'fail',
      expectedCount: expectedLeads,
      actualCount: mappedLeads,
      details: {},
    });

    for (const [sourceTable, targetTable, checkKey] of [
      ['Qualifications', 'app.qualification_sessions', 'qualifications_mapped'],
      ['Scores', 'app.score_runs', 'scores_mapped'],
      ['Messages', 'app.messages', 'messages_mapped'],
      ['FollowUps', 'app.followups', 'followups_mapped'],
      ['Appointments', 'app.appointments', 'appointments_mapped'],
      ['Events', 'audit.events', 'events_mapped'],
    ] as const) {
      const expected = Number(rawCounts[sourceTable] || 0);
      const actual = await mappedCountForRun(client, importRunId, sourceTable, targetTable);
      checks.push({
        checkKey,
        status: actual === expected ? 'pass' : 'fail',
        expectedCount: expected,
        actualCount: actual,
        details: {},
      });
    }

    const duplicateContacts = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM (
         SELECT client_id, phone_e164
         FROM app.contacts
         GROUP BY client_id, phone_e164
         HAVING count(*) > 1
       ) duplicates`,
    );
    checks.push({
      checkKey: 'contact_phone_uniqueness',
      status: duplicateContacts === 0 ? 'pass' : 'fail',
      expectedCount: 0,
      actualCount: duplicateContacts,
      details: {},
    });

    const leadsWithoutContacts = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM app.leads l
       LEFT JOIN app.contacts c ON c.contact_id=l.contact_id
       WHERE c.contact_id IS NULL`,
    );
    checks.push({
      checkKey: 'lead_contact_links',
      status: leadsWithoutContacts === 0 ? 'pass' : 'fail',
      expectedCount: 0,
      actualCount: leadsWithoutContacts,
      details: {},
    });

    if (input.recordResults) {
      for (const check of checks) {
        await client.query(
          `INSERT INTO migration.reconciliation_results
            (import_run_id, check_key, status, expected_count, actual_count, details_json)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            importRunId,
            check.checkKey,
            check.status,
            check.expectedCount,
            check.actualCount,
            JSON.stringify(check.details),
          ],
        );
      }
    }

    return { importRunId, checks };
  } finally {
    client.release();
    await closePool();
  }
}

function parseArgs(argv: string[]): { importRunId?: string; recordResults: boolean } {
  const importRunId = argv.find((arg) => arg.startsWith('--import-run-id='))?.slice('--import-run-id='.length);
  return importRunId
    ? { importRunId, recordResults: argv.includes('--record-results') }
    : { recordResults: argv.includes('--record-results') };
}

async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const result = await reconcileAirtableImport(parseArgs(argv));
  const failed = result.checks.filter((check) => check.status === 'fail');
  console.log(JSON.stringify({ ok: failed.length === 0, ...result }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Airtable reconciliation failed: ${message}`);
    process.exitCode = 1;
  });
}
