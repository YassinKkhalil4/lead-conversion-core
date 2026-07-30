import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';

type AirtableFields = Record<string, unknown>;

interface AirtableRecord {
  id: string;
  fields: AirtableFields;
  contentHash: string;
}

interface TableLoad {
  tableName: string;
  records: AirtableRecord[];
  valid: AirtableRecord[];
  rejected: Array<{ record: AirtableRecord; reason: string }>;
}

interface ImportSummary {
  inputDir: string;
  dryRun: boolean;
  tables: Record<string, {
    total: number;
    valid: number;
    rejected: number;
    missing: boolean;
  }>;
  totalRecords: number;
  validRecords: number;
  rejectedRecords: number;
  missingTables: string[];
}

const REQUIRED_TABLES = [
  'Clients',
  'Projects',
  'Salespeople',
  'Questions',
  'Question Options',
  'Conversation Messages',
  'Leads',
  'Qualifications',
  'Messages',
  'FollowUps',
  'Appointments',
  'Scores',
  'Events',
];

const REQUIRED_FIELDS: Record<string, string[]> = {
  Clients: ['Company Name'],
  Projects: ['Project Name'],
  Salespeople: ['Name', 'Phone'],
  Leads: ['Phone Raw'],
  Messages: ['Direction', 'Message Text'],
};

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

function stringField(fields: AirtableFields, key: string): string {
  const value = fields[key];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(',');
  return String(value ?? '').trim();
}

function linkedRecord(fields: AirtableFields, key: string): string {
  const value = fields[key];
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('20')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+20${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('1')) return `+20${digits}`;
  return raw.trim();
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

async function loadTable(inputDir: string, tableName: string): Promise<TableLoad> {
  const files = await readdir(inputDir);
  const wanted = normalizeTableName(tableName);
  const file = files.find((candidate) => {
    const extension = extname(candidate).toLocaleLowerCase();
    if (!['.json', '.csv'].includes(extension)) return false;
    return normalizeTableName(candidate.slice(0, -extension.length)) === wanted;
  });
  if (!file) return { tableName, records: [], valid: [], rejected: [] };

  const fullPath = join(inputDir, file);
  const text = await readFile(fullPath, 'utf8');
  const rawRows = extname(file).toLocaleLowerCase() === '.csv'
    ? parseCsv(text)
    : coerceJsonRecords(JSON.parse(text), tableName);

  const records = rawRows.map((fields, index) => {
    const recordId = stringField(fields, 'id') || stringField(fields, 'Record ID') || `${tableName}:${contentHash(fields).slice(0, 16)}:${index}`;
    const normalizedFields = { ...fields };
    delete normalizedFields.id;
    return {
      id: recordId,
      fields: normalizedFields,
      contentHash: contentHash(normalizedFields),
    };
  });

  const required = REQUIRED_FIELDS[tableName] || [];
  const rejected: TableLoad['rejected'] = [];
  const valid = records.filter((record) => {
    const missing = required.filter((field) => stringField(record.fields, field) === '');
    if (missing.length > 0) {
      rejected.push({ record, reason: `missing_required_fields:${missing.join(',')}` });
      return false;
    }
    return true;
  });

  return { tableName, records, valid, rejected };
}

export async function loadAirtableExport(inputDir: string): Promise<{ loads: TableLoad[]; summary: ImportSummary }> {
  const loads = await Promise.all(REQUIRED_TABLES.map((table) => loadTable(inputDir, table)));
  const summary: ImportSummary = {
    inputDir,
    dryRun: true,
    tables: {},
    totalRecords: 0,
    validRecords: 0,
    rejectedRecords: 0,
    missingTables: [],
  };

  for (const load of loads) {
    const missing = load.records.length === 0;
    if (missing) summary.missingTables.push(load.tableName);
    summary.tables[load.tableName] = {
      total: load.records.length,
      valid: load.valid.length,
      rejected: load.rejected.length,
      missing,
    };
    summary.totalRecords += load.records.length;
    summary.validRecords += load.valid.length;
    summary.rejectedRecords += load.rejected.length;
  }

  return { loads, summary };
}

async function upsertEntityMap(client: PoolClient, input: {
  sourceTable: string;
  sourceRecordId: string;
  targetTable: string;
  targetId: string;
  contentHash: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO migration.entity_map
      (source_table, source_record_id, target_table, target_id, content_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_system, source_table, source_record_id, target_table)
     DO UPDATE SET target_id=EXCLUDED.target_id, content_hash=EXCLUDED.content_hash, updated_at=now()`,
    [input.sourceTable, input.sourceRecordId, input.targetTable, input.targetId, input.contentHash],
  );
}

async function mappedId(client: PoolClient, sourceTable: string, sourceRecordId: string, targetTable: string): Promise<string | null> {
  const result = await client.query<{ target_id: string }>(
    `SELECT target_id FROM migration.entity_map
     WHERE source_system='airtable' AND source_table=$1 AND source_record_id=$2 AND target_table=$3`,
    [sourceTable, sourceRecordId, targetTable],
  );
  return result.rows[0]?.target_id || null;
}

async function applyImport(inputDir: string, loads: TableLoad[], summary: ImportSummary): Promise<string> {
  const [{ pool, closePool }] = await Promise.all([import('../src/db/pool.js')]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query<{ import_run_id: string }>(
      `INSERT INTO migration.import_runs (source_path, mode, status)
       VALUES ($1, 'apply', 'running')
       RETURNING import_run_id`,
      [inputDir],
    );
    const importRunId = run.rows[0]?.import_run_id;
    if (!importRunId) throw new Error('import_run_not_created');

    for (const load of loads) {
      for (const record of load.records) {
        await client.query(
          `INSERT INTO migration.airtable_raw_records
            (import_run_id, table_name, record_id, content_hash, fields_json)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (import_run_id, table_name, record_id) DO NOTHING`,
          [importRunId, load.tableName, record.id, record.contentHash, JSON.stringify(record.fields)],
        );
      }
      for (const rejected of load.rejected) {
        await client.query(
          `INSERT INTO migration.rejected_records
            (import_run_id, table_name, record_id, content_hash, reason, fields_json)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            importRunId,
            load.tableName,
            rejected.record.id,
            rejected.record.contentHash,
            rejected.reason,
            JSON.stringify(rejected.record.fields),
          ],
        );
      }
    }

    const clients = loads.find((load) => load.tableName === 'Clients')?.valid || [];
    for (const record of clients) {
      const clientKey = stringField(record.fields, 'Client ID') || record.id;
      const result = await client.query<{ client_id: string }>(
        `INSERT INTO app.clients
          (legacy_airtable_id, client_key, company_name, active, manager_name, manager_phone_e164,
           whatsapp_provider, calendar_id, appointment_hours, appointment_blackout_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::text[])
         ON CONFLICT (legacy_airtable_id) DO UPDATE SET
          client_key=EXCLUDED.client_key,
          company_name=EXCLUDED.company_name,
          active=EXCLUDED.active,
          manager_name=EXCLUDED.manager_name,
          manager_phone_e164=EXCLUDED.manager_phone_e164,
          whatsapp_provider=EXCLUDED.whatsapp_provider,
          calendar_id=EXCLUDED.calendar_id,
          appointment_hours=EXCLUDED.appointment_hours,
          appointment_blackout_days=EXCLUDED.appointment_blackout_days,
          updated_at=now()
         RETURNING client_id`,
        [
          record.id,
          clientKey,
          stringField(record.fields, 'Company Name'),
          stringField(record.fields, 'Active') !== 'false',
          stringField(record.fields, 'Manager Name'),
          normalizePhone(stringField(record.fields, 'Manager Phone')),
          stringField(record.fields, 'WhatsApp Provider') || 'meta',
          stringField(record.fields, 'Calendar ID'),
          JSON.stringify(splitList(record.fields['Appointment Hours']).length > 0 ? splitList(record.fields['Appointment Hours']) : ['11:00', '14:00', '16:00']),
          splitList(record.fields['Appointment Blackout Days']).length > 0 ? splitList(record.fields['Appointment Blackout Days']) : ['Friday'],
        ],
      );
      await upsertEntityMap(client, {
        sourceTable: 'Clients',
        sourceRecordId: record.id,
        targetTable: 'app.clients',
        targetId: result.rows[0]?.client_id || '',
        contentHash: record.contentHash,
      });
    }

    const projects = loads.find((load) => load.tableName === 'Projects')?.valid || [];
    for (const record of projects) {
      const clientRecordId = linkedRecord(record.fields, 'Client') || linkedRecord(record.fields, 'Clients');
      const clientId = clientRecordId ? await mappedId(client, 'Clients', clientRecordId, 'app.clients') : null;
      const result = await client.query<{ project_id: string }>(
        `INSERT INTO app.projects
          (legacy_airtable_id, client_id, project_name, active, starting_price, max_price, unit_types, location, maps_url)
         VALUES ($1, $2, $3, $4, NULLIF($5, '')::numeric, NULLIF($6, '')::numeric, $7::text[], $8, $9)
         ON CONFLICT (legacy_airtable_id) DO UPDATE SET
          client_id=EXCLUDED.client_id,
          project_name=EXCLUDED.project_name,
          active=EXCLUDED.active,
          starting_price=EXCLUDED.starting_price,
          max_price=EXCLUDED.max_price,
          unit_types=EXCLUDED.unit_types,
          location=EXCLUDED.location,
          maps_url=EXCLUDED.maps_url,
          updated_at=now()
         RETURNING project_id`,
        [
          record.id,
          clientId,
          stringField(record.fields, 'Project Name'),
          stringField(record.fields, 'Active') !== 'false',
          stringField(record.fields, 'Starting Price'),
          stringField(record.fields, 'Max Price'),
          splitList(record.fields['Unit Types']),
          stringField(record.fields, 'Location'),
          stringField(record.fields, 'Maps URL'),
        ],
      );
      await upsertEntityMap(client, {
        sourceTable: 'Projects',
        sourceRecordId: record.id,
        targetTable: 'app.projects',
        targetId: result.rows[0]?.project_id || '',
        contentHash: record.contentHash,
      });
    }

    const salespeople = loads.find((load) => load.tableName === 'Salespeople')?.valid || [];
    for (const record of salespeople) {
      const clientRecordId = linkedRecord(record.fields, 'Client') || linkedRecord(record.fields, 'Clients');
      const clientId = clientRecordId ? await mappedId(client, 'Clients', clientRecordId, 'app.clients') : null;
      if (!clientId) {
        await client.query(
          `INSERT INTO migration.rejected_records
            (import_run_id, table_name, record_id, content_hash, reason, fields_json)
           VALUES ($1, 'Salespeople', $2, $3, 'missing_mapped_client', $4::jsonb)`,
          [importRunId, record.id, record.contentHash, JSON.stringify(record.fields)],
        );
        continue;
      }
      const result = await client.query<{ salesperson_id: string }>(
        `INSERT INTO app.salespeople
          (legacy_airtable_id, client_id, name, phone_e164, email, active, unit_specialties, locations, languages, priority_rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], COALESCE(NULLIF($10, '')::integer, 100))
         ON CONFLICT (legacy_airtable_id) DO UPDATE SET
          client_id=EXCLUDED.client_id,
          name=EXCLUDED.name,
          phone_e164=EXCLUDED.phone_e164,
          email=EXCLUDED.email,
          active=EXCLUDED.active,
          unit_specialties=EXCLUDED.unit_specialties,
          locations=EXCLUDED.locations,
          languages=EXCLUDED.languages,
          priority_rank=EXCLUDED.priority_rank,
          updated_at=now()
         RETURNING salesperson_id`,
        [
          record.id,
          clientId,
          stringField(record.fields, 'Name'),
          normalizePhone(stringField(record.fields, 'Phone')),
          stringField(record.fields, 'Email'),
          stringField(record.fields, 'Active') !== 'false',
          splitList(record.fields['Unit Specialties']),
          splitList(record.fields['Locations']),
          splitList(record.fields['Languages']),
          stringField(record.fields, 'Priority Rank'),
        ],
      );
      await upsertEntityMap(client, {
        sourceTable: 'Salespeople',
        sourceRecordId: record.id,
        targetTable: 'app.salespeople',
        targetId: result.rows[0]?.salesperson_id || '',
        contentHash: record.contentHash,
      });
    }

    const leads = loads.find((load) => load.tableName === 'Leads')?.valid || [];
    for (const record of leads) {
      const clientRecordId = linkedRecord(record.fields, 'Client') || linkedRecord(record.fields, 'Clients');
      const projectRecordId = linkedRecord(record.fields, 'Project Linked') || linkedRecord(record.fields, 'Project') || linkedRecord(record.fields, 'Projects');
      const clientId = clientRecordId ? await mappedId(client, 'Clients', clientRecordId, 'app.clients') : null;
      if (!clientId) {
        await client.query(
          `INSERT INTO migration.rejected_records
            (import_run_id, table_name, record_id, content_hash, reason, fields_json)
           VALUES ($1, 'Leads', $2, $3, 'missing_mapped_client', $4::jsonb)`,
          [importRunId, record.id, record.contentHash, JSON.stringify(record.fields)],
        );
        continue;
      }
      const phoneRaw = stringField(record.fields, 'Phone Raw') || stringField(record.fields, 'Phone Normalized');
      const phoneE164 = normalizePhone(phoneRaw);
      const contact = await client.query<{ contact_id: string }>(
        `INSERT INTO app.contacts
          (client_id, legacy_airtable_id, name, phone_raw, phone_e164, email, consent_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (client_id, phone_e164) DO UPDATE SET
          name=COALESCE(NULLIF(EXCLUDED.name, ''), app.contacts.name),
          phone_raw=COALESCE(NULLIF(EXCLUDED.phone_raw, ''), app.contacts.phone_raw),
          email=COALESCE(NULLIF(EXCLUDED.email, ''), app.contacts.email),
          consent_status=COALESCE(NULLIF(EXCLUDED.consent_status, ''), app.contacts.consent_status),
          updated_at=now()
         RETURNING contact_id`,
        [
          clientId,
          record.id,
          stringField(record.fields, 'Name'),
          phoneRaw,
          phoneE164,
          stringField(record.fields, 'Email'),
          stringField(record.fields, 'Consent Status') || 'unknown',
        ],
      );
      const contactId = contact.rows[0]?.contact_id;
      if (!contactId) throw new Error(`contact_not_created:${record.id}`);
      await upsertEntityMap(client, {
        sourceTable: 'Leads',
        sourceRecordId: record.id,
        targetTable: 'app.contacts',
        targetId: contactId,
        contentHash: record.contentHash,
      });

      const projectId = projectRecordId ? await mappedId(client, 'Projects', projectRecordId, 'app.projects') : null;
      const lead = await client.query<{ lead_id: string }>(
        `INSERT INTO app.leads
          (client_id, contact_id, project_id, legacy_airtable_id, provider, provider_external_id,
           source, source_payload_hash, status, current_stage, first_received_at, temperature,
           lead_score, stop_follow_up, stop_reason, closed_status)
         VALUES ($1, $2, $3, $4, 'airtable', $4, $5, $6, $7, $8,
           NULLIF($9, '')::timestamptz, $10, NULLIF($11, '')::integer, $12, $13, $14)
         ON CONFLICT (legacy_airtable_id) DO UPDATE SET
          contact_id=EXCLUDED.contact_id,
          project_id=EXCLUDED.project_id,
          source=EXCLUDED.source,
          source_payload_hash=EXCLUDED.source_payload_hash,
          status=EXCLUDED.status,
          current_stage=EXCLUDED.current_stage,
          first_received_at=COALESCE(EXCLUDED.first_received_at, app.leads.first_received_at),
          temperature=EXCLUDED.temperature,
          lead_score=EXCLUDED.lead_score,
          stop_follow_up=EXCLUDED.stop_follow_up,
          stop_reason=EXCLUDED.stop_reason,
          closed_status=EXCLUDED.closed_status,
          updated_at=now()
         RETURNING lead_id`,
        [
          clientId,
          contactId,
          projectId,
          record.id,
          stringField(record.fields, 'Source') || stringField(record.fields, 'Project Interest'),
          record.contentHash,
          stringField(record.fields, 'Status') || 'open',
          stringField(record.fields, 'Current Stage'),
          stringField(record.fields, 'First Received At'),
          stringField(record.fields, 'Temperature'),
          stringField(record.fields, 'Lead Score'),
          stringField(record.fields, 'Stop Follow-Up') === 'true',
          stringField(record.fields, 'Stop Reason'),
          stringField(record.fields, 'Closed Status'),
        ],
      );
      await upsertEntityMap(client, {
        sourceTable: 'Leads',
        sourceRecordId: record.id,
        targetTable: 'app.leads',
        targetId: lead.rows[0]?.lead_id || '',
        contentHash: record.contentHash,
      });
    }

    await client.query(
      `UPDATE migration.import_runs
       SET status='completed', completed_at=now(), summary_json=$2::jsonb
       WHERE import_run_id=$1`,
      [importRunId, JSON.stringify({ ...summary, dryRun: false })],
    );
    await client.query('COMMIT');
    return importRunId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

function parseArgs(argv: string[]): { inputDir: string; apply: boolean } {
  const inputDir = argv.find((arg) => arg.startsWith('--input='))?.slice('--input='.length) || argv[0] || '';
  return {
    inputDir,
    apply: argv.includes('--apply'),
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (!args.inputDir) throw new Error('Usage: npm run import:airtable -- --input=imports/airtable [--apply]');
  const { loads, summary } = await loadAirtableExport(args.inputDir);
  if (args.apply) {
    const importRunId = await applyImport(args.inputDir, loads, summary);
    console.log(JSON.stringify({ ok: true, dryRun: false, importRunId, summary: { ...summary, dryRun: false } }, null, 2));
    return;
  }
  console.log(JSON.stringify({ ok: true, dryRun: true, summary }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Airtable import failed: ${message}`);
    process.exitCode = 1;
  });
}
