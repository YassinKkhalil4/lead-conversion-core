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

async function groupedCounts(client: PoolClient, sql: string, values: unknown[] = []): Promise<Record<string, number>> {
  const result = await client.query<{ key: string; count: string }>(sql, values);
  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.count)]));
}

function countTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function countsMatch(expected: Record<string, number>, actual: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    if ((expected[key] || 0) !== (actual[key] || 0)) return false;
  }
  return true;
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

async function rejectedCountForRun(client: PoolClient, importRunId: string, sourceTable: string): Promise<number> {
  return scalar(
    client,
    `SELECT count(*)::text AS count
     FROM migration.rejected_records
     WHERE import_run_id=$1
       AND table_name=$2`,
    [importRunId, sourceTable],
  );
}

async function acceptedRawCountForRun(client: PoolClient, importRunId: string, rawCounts: Record<string, number>, sourceTable: string): Promise<{
  rawCount: number;
  rejectedCount: number;
  acceptedCount: number;
}> {
  const rawCount = Number(rawCounts[sourceTable] || 0);
  const rejectedCount = await rejectedCountForRun(client, importRunId, sourceTable);
  return {
    rawCount,
    rejectedCount,
    acceptedCount: Math.max(rawCount - rejectedCount, 0),
  };
}

function distributionCheck(checkKey: string, expected: Record<string, number>, actual: Record<string, number>): ReconciliationCheck {
  return {
    checkKey,
    status: countsMatch(expected, actual) ? 'pass' : 'fail',
    expectedCount: countTotal(expected),
    actualCount: countTotal(actual),
    details: { expected, actual },
  };
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
      status: rejectedCount === 0 ? 'pass' : 'fail',
      expectedCount: 0,
      actualCount: rejectedCount,
      details: {},
    });

    const clientsCounts = await acceptedRawCountForRun(client, importRunId, rawCounts, 'Clients');
    const mappedClients = await mappedCountForRun(client, importRunId, 'Clients', 'app.clients');
    checks.push({
      checkKey: 'clients_mapped',
      status: mappedClients === clientsCounts.acceptedCount ? 'pass' : 'fail',
      expectedCount: clientsCounts.acceptedCount,
      actualCount: mappedClients,
      details: clientsCounts,
    });

    const projectsCounts = await acceptedRawCountForRun(client, importRunId, rawCounts, 'Projects');
    const mappedProjects = await mappedCountForRun(client, importRunId, 'Projects', 'app.projects');
    checks.push({
      checkKey: 'projects_mapped',
      status: mappedProjects === projectsCounts.acceptedCount ? 'pass' : 'fail',
      expectedCount: projectsCounts.acceptedCount,
      actualCount: mappedProjects,
      details: projectsCounts,
    });

    const salespeopleCounts = await acceptedRawCountForRun(client, importRunId, rawCounts, 'Salespeople');
    const mappedSalespeople = await mappedCountForRun(client, importRunId, 'Salespeople', 'app.salespeople');
    checks.push({
      checkKey: 'salespeople_mapped',
      status: mappedSalespeople === salespeopleCounts.acceptedCount ? 'pass' : 'fail',
      expectedCount: salespeopleCounts.acceptedCount,
      actualCount: mappedSalespeople,
      details: salespeopleCounts,
    });

    const leadsCounts = await acceptedRawCountForRun(client, importRunId, rawCounts, 'Leads');
    const mappedLeads = await mappedCountForRun(client, importRunId, 'Leads', 'app.leads');
    checks.push({
      checkKey: 'leads_mapped',
      status: mappedLeads === leadsCounts.acceptedCount ? 'pass' : 'fail',
      expectedCount: leadsCounts.acceptedCount,
      actualCount: mappedLeads,
      details: leadsCounts,
    });

    for (const [sourceTable, targetTable, checkKey] of [
      ['Qualifications', 'app.qualification_sessions', 'qualifications_mapped'],
      ['Scores', 'app.score_runs', 'scores_mapped'],
      ['Messages', 'app.messages', 'messages_mapped'],
      ['FollowUps', 'app.followups', 'followups_mapped'],
      ['Appointments', 'app.appointments', 'appointments_mapped'],
      ['Events', 'audit.events', 'events_mapped'],
    ] as const) {
      const counts = await acceptedRawCountForRun(client, importRunId, rawCounts, sourceTable);
      const actual = await mappedCountForRun(client, importRunId, sourceTable, targetTable);
      checks.push({
        checkKey,
        status: actual === counts.acceptedCount ? 'pass' : 'fail',
        expectedCount: counts.acceptedCount,
        actualCount: actual,
        details: counts,
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

    const sourceLeadStatusDistribution = await groupedCounts(
      client,
      `SELECT COALESCE(NULLIF(raw.fields_json->>'Status', ''), 'open') AS key,
              count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.leads'
       WHERE raw.import_run_id=$1
         AND raw.table_name='Leads'
       GROUP BY key
       ORDER BY key`,
      [importRunId],
    );
    const targetLeadStatusDistribution = await groupedCounts(
      client,
      `SELECT l.status AS key,
              count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.leads'
       JOIN app.leads l ON l.lead_id=mapped.target_id
       WHERE raw.import_run_id=$1
         AND raw.table_name='Leads'
       GROUP BY l.status
       ORDER BY l.status`,
      [importRunId],
    );
    checks.push(distributionCheck('lead_status_distribution', sourceLeadStatusDistribution, targetLeadStatusDistribution));

    const activeLeadSourceCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.leads'
       WHERE raw.import_run_id=$1
         AND raw.table_name='Leads'
         AND lower(COALESCE(NULLIF(raw.fields_json->>'Status', ''), 'open')) NOT IN ('closed','closed_lost','closed_won','lost')`,
      [importRunId],
    );
    const activeLeadTargetCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.leads'
       JOIN app.leads l ON l.lead_id=mapped.target_id
       WHERE raw.import_run_id=$1
         AND raw.table_name='Leads'
         AND lower(l.status) NOT IN ('closed','closed_lost','closed_won','lost')`,
      [importRunId],
    );
    checks.push({
      checkKey: 'active_leads_count',
      status: activeLeadSourceCount === activeLeadTargetCount ? 'pass' : 'fail',
      expectedCount: activeLeadSourceCount,
      actualCount: activeLeadTargetCount,
      details: { closedStatuses: ['closed', 'closed_lost', 'closed_won', 'lost'] },
    });

    const sourceStopFollowUpCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.leads'
       WHERE raw.import_run_id=$1
         AND raw.table_name='Leads'
         AND lower(COALESCE(raw.fields_json->>'Stop Follow-Up', '')) = 'true'`,
      [importRunId],
    );
    const targetStopFollowUpCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.leads'
       JOIN app.leads l ON l.lead_id=mapped.target_id
       WHERE raw.import_run_id=$1
         AND raw.table_name='Leads'
         AND l.stop_follow_up`,
      [importRunId],
    );
    checks.push({
      checkKey: 'stop_follow_up_count',
      status: sourceStopFollowUpCount === targetStopFollowUpCount ? 'pass' : 'fail',
      expectedCount: sourceStopFollowUpCount,
      actualCount: targetStopFollowUpCount,
      details: {},
    });

    const sourcePendingFollowupCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.followups'
       WHERE raw.import_run_id=$1
         AND raw.table_name='FollowUps'
         AND lower(COALESCE(NULLIF(raw.fields_json->>'Status', ''), 'scheduled')) IN ('pending','scheduled')`,
      [importRunId],
    );
    const targetPendingFollowupCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.followups'
       JOIN app.followups f ON f.followup_id=mapped.target_id
       WHERE raw.import_run_id=$1
         AND raw.table_name='FollowUps'
         AND lower(f.status) IN ('pending','scheduled')`,
      [importRunId],
    );
    checks.push({
      checkKey: 'pending_followups_count',
      status: sourcePendingFollowupCount === targetPendingFollowupCount ? 'pass' : 'fail',
      expectedCount: sourcePendingFollowupCount,
      actualCount: targetPendingFollowupCount,
      details: { countedStatuses: ['pending', 'scheduled'] },
    });

    const sourceOpenBookedAppointmentCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.appointments'
       WHERE raw.import_run_id=$1
         AND raw.table_name='Appointments'
         AND lower(COALESCE(NULLIF(raw.fields_json->>'Status', ''), NULLIF(raw.fields_json->>'Appointment Status', ''), 'pending')) IN ('open','pending','booked','confirmed')`,
      [importRunId],
    );
    const targetOpenBookedAppointmentCount = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM migration.airtable_raw_records raw
       JOIN migration.entity_map mapped
         ON mapped.source_system='airtable'
        AND mapped.source_table=raw.table_name
        AND mapped.source_record_id=raw.record_id
        AND mapped.target_table='app.appointments'
       JOIN app.appointments a ON a.appointment_id=mapped.target_id
       WHERE raw.import_run_id=$1
         AND raw.table_name='Appointments'
         AND lower(a.status) IN ('open','pending','booked','confirmed')`,
      [importRunId],
    );
    checks.push({
      checkKey: 'open_booked_appointments_count',
      status: sourceOpenBookedAppointmentCount === targetOpenBookedAppointmentCount ? 'pass' : 'fail',
      expectedCount: sourceOpenBookedAppointmentCount,
      actualCount: targetOpenBookedAppointmentCount,
      details: { countedStatuses: ['open', 'pending', 'booked', 'confirmed'] },
    });

    const duplicateProviderMessageIds = await scalar(
      client,
      `SELECT count(*)::text AS count
       FROM (
         SELECT client_id, provider_message_id
         FROM app.messages
         WHERE provider_message_id <> ''
         GROUP BY client_id, provider_message_id
         HAVING count(*) > 1
       ) duplicates`,
    );
    checks.push({
      checkKey: 'message_provider_id_uniqueness',
      status: duplicateProviderMessageIds === 0 ? 'pass' : 'fail',
      expectedCount: 0,
      actualCount: duplicateProviderMessageIds,
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
