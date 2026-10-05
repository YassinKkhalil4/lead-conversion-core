import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { CompileInput } from '../src/domain/compiler.js';
import { LANGUAGES } from '../src/domain/language.js';

/**
 * Creates (or updates) a hospitality tenant from one JSON spec: the client, its
 * venue, zones, shifts, capacity, hosts, the WhatsApp number, and a published
 * conversation config whose zone buttons are this venue's zones.
 *
 *   npm run tenant:hospitality -- --spec path/to/tenant.json
 *   npm run tenant:hospitality -- --spec path/to/tenant.json --validate-only
 *
 * Re-running with an edited spec updates in place. Capacity rows and zone,
 * shift and host rows are upserted by their keys; nothing is deleted, so a zone
 * removed from the spec is switched off (active = false), never lost under
 * existing reservations. Dashboard logins are created separately with
 * `npm run user:create`.
 */

const labels = z.record(z.enum(['English', 'Spanish', 'Catalan', 'Arabic']), z.string().min(1).max(80)).refine((v) => Boolean(v.English), {
  message: 'English label is required (it is the fallback)',
});
const key = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const specSchema = z.object({
  clientKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  clientRecordId: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  companyName: z.string().min(1).max(200),
  timezone: z.string().min(3).max(60).refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, { message: 'unknown timezone' }),
  managerPhoneE164: z.string().regex(/^\+\d{6,15}$/).default(''),
  depositThresholdPartySize: z.number().int().min(1).max(200).nullable().default(null),
  whatsapp: z.object({ phoneNumberId: z.string().min(1).max(100), directSendEnabled: z.boolean().default(false) }),
  languages: z.array(z.enum(LANGUAGES as unknown as [string, ...string[]])).min(1).max(3),
  venue: z.object({ name: z.string().min(1).max(200), location: z.string().max(200).default(''), mapsUrl: z.string().max(2000).default('') }),
  zones: z.array(z.object({ key, labels, sortOrder: z.number().int().optional() })).min(1).max(3),
  shifts: z.array(z.object({
    key, labels, start: time, lastSeating: time,
    daysOpen: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5, 6, 7]),
  })).min(1).max(6),
  capacity: z.array(z.object({ zone: key, shift: key, covers: z.number().int().min(0).max(5000) })).min(1),
  hosts: z.array(z.object({ name: z.string().min(1).max(200), phoneE164: z.string().regex(/^\+\d{6,15}$/) })).min(1).max(50),
}).superRefine((spec, ctx) => {
  const zones = new Set(spec.zones.map((z) => z.key));
  const shifts = new Set(spec.shifts.map((s) => s.key));
  if (zones.size !== spec.zones.length) ctx.addIssue({ code: 'custom', message: 'duplicate zone key' });
  if (shifts.size !== spec.shifts.length) ctx.addIssue({ code: 'custom', message: 'duplicate shift key' });
  for (const shift of spec.shifts) {
    if (shift.lastSeating < shift.start) ctx.addIssue({ code: 'custom', message: `shift ${shift.key}: lastSeating is before start` });
  }
  for (const row of spec.capacity) {
    if (!zones.has(row.zone)) ctx.addIssue({ code: 'custom', message: `capacity names unknown zone ${row.zone}` });
    if (!shifts.has(row.shift)) ctx.addIssue({ code: 'custom', message: `capacity names unknown shift ${row.shift}` });
  }
  // WhatsApp shows at most three buttons: the zone question is a button question.
  if (spec.zones.length > 3) ctx.addIssue({ code: 'custom', message: 'at most three zones (WhatsApp buttons)' });
});

export type HospitalityTenantSpec = z.infer<typeof specSchema>;

export interface ProvisionResult {
  clientId: string;
  projectId: string;
  versionKey: string;
}

/** The seed config with the zone buttons replaced by this venue's zones and its languages. */
export function buildConfig(spec: HospitalityTenantSpec, seedPath: string): CompileInput {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as CompileInput & { languages?: string[] };
  const zoneQuestion = seed.questions.find((q) => q.fields['Question Key'] === 'q_zone');
  if (!zoneQuestion) throw new Error('seed has no q_zone question');
  const others = seed.options.filter((o) => !(Array.isArray(o.fields.Question) && o.fields.Question.includes(zoneQuestion.id)));
  const zoneOptions = spec.zones.map((zone, index) => ({
    id: `recHZ${spec.clientKey.replace(/[^a-z0-9]/gi, '').slice(0, 6)}${String(index).padStart(4, '0')}`,
    fields: {
      Question: [zoneQuestion.id],
      'Option Key': `zone_${zone.key}`,
      Value: zone.key,
      Order: index + 1,
      Active: true,
      English: zone.labels.English,
      Spanish: zone.labels.Spanish ?? zone.labels.English,
      Catalan: zone.labels.Catalan ?? zone.labels.English,
      Arabic: '',
    },
  }));
  return { ...seed, languages: spec.languages as CompileInput['languages'], options: [...others, ...zoneOptions] } as CompileInput;
}

export async function provisionHospitalityTenant(rawSpec: unknown, seedPath = resolve('config/seed-hospitality.json')): Promise<ProvisionResult> {
  const spec = specSchema.parse(rawSpec);
  const [{ withTransaction }, { VersionedConfigService }] = await Promise.all([
    import('../src/db/transaction.js'),
    import('../src/configuration/versioned-config-service.js'),
  ]);

  const dir = mkdtempSync(join(tmpdir(), 'hospitality-config.'));
  let published: { versionKey: string };
  try {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify(buildConfig(spec, seedPath)));
    published = await new VersionedConfigService().publish({ sourcePath: path, clientRecordId: spec.clientRecordId, publishedBy: 'provision-hospitality-tenant' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return withTransaction(async (db) => {
    const client = await db.query<{ client_id: string }>(
      `INSERT INTO app.clients (client_key, legacy_airtable_id, company_name, manager_phone_e164, timezone, vertical, deposit_threshold_party_size, floor_plan_provider)
       VALUES ($1, $2, $3, $4, $5, 'hospitality', $6, 'kadensio')
       ON CONFLICT (client_key) DO UPDATE SET
         legacy_airtable_id=EXCLUDED.legacy_airtable_id, company_name=EXCLUDED.company_name,
         manager_phone_e164=EXCLUDED.manager_phone_e164, timezone=EXCLUDED.timezone,
         vertical='hospitality', deposit_threshold_party_size=EXCLUDED.deposit_threshold_party_size, updated_at=now()
       RETURNING client_id`,
      [spec.clientKey, spec.clientRecordId, spec.companyName, spec.managerPhoneE164, spec.timezone, spec.depositThresholdPartySize],
    );
    const clientId = client.rows[0]!.client_id;

    // A venue is a project; reuse it by name so re-running does not duplicate it.
    const existing = await db.query<{ project_id: string }>(
      `SELECT project_id FROM app.projects WHERE client_id=$1 AND project_name=$2`, [clientId, spec.venue.name]);
    const projectId = existing.rows[0]?.project_id
      ?? (await db.query<{ project_id: string }>(
        `INSERT INTO app.projects (client_id, project_name, location, maps_url) VALUES ($1, $2, $3, $4) RETURNING project_id`,
        [clientId, spec.venue.name, spec.venue.location, spec.venue.mapsUrl])).rows[0]!.project_id;
    await db.query(`UPDATE app.projects SET location=$2, maps_url=$3, active=true, updated_at=now() WHERE project_id=$1`, [projectId, spec.venue.location, spec.venue.mapsUrl]);

    const zoneIds = new Map<string, string>();
    for (const [index, zone] of spec.zones.entries()) {
      const row = await db.query<{ zone_id: string }>(
        `INSERT INTO app.venue_zones (client_id, project_id, zone_key, labels, sort_order, active)
         VALUES ($1, $2, $3, $4::jsonb, $5, true)
         ON CONFLICT (project_id, zone_key) DO UPDATE SET labels=EXCLUDED.labels, sort_order=EXCLUDED.sort_order, active=true, updated_at=now()
         RETURNING zone_id`,
        [clientId, projectId, zone.key, JSON.stringify(zone.labels), zone.sortOrder ?? (index + 1) * 10],
      );
      zoneIds.set(zone.key, row.rows[0]!.zone_id);
    }
    await db.query(`UPDATE app.venue_zones SET active=false, updated_at=now() WHERE project_id=$1 AND NOT (zone_key = ANY($2::text[]))`, [projectId, spec.zones.map((z) => z.key)]);

    const shiftIds = new Map<string, string>();
    for (const [index, shift] of spec.shifts.entries()) {
      const row = await db.query<{ shift_id: string }>(
        `INSERT INTO app.venue_shifts (client_id, project_id, shift_key, labels, starts_at_local, last_seating_local, days_open, sort_order, active)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::smallint[], $8, true)
         ON CONFLICT (project_id, shift_key) DO UPDATE SET labels=EXCLUDED.labels, starts_at_local=EXCLUDED.starts_at_local,
           last_seating_local=EXCLUDED.last_seating_local, days_open=EXCLUDED.days_open, sort_order=EXCLUDED.sort_order, active=true, updated_at=now()
         RETURNING shift_id`,
        [clientId, projectId, shift.key, JSON.stringify(shift.labels), shift.start, shift.lastSeating, shift.daysOpen, (index + 1) * 10],
      );
      shiftIds.set(shift.key, row.rows[0]!.shift_id);
    }
    await db.query(`UPDATE app.venue_shifts SET active=false, updated_at=now() WHERE project_id=$1 AND NOT (shift_key = ANY($2::text[]))`, [projectId, spec.shifts.map((s) => s.key)]);

    for (const row of spec.capacity) {
      await db.query(
        `INSERT INTO app.venue_capacity (zone_id, shift_id, covers) VALUES ($1, $2, $3)
         ON CONFLICT (zone_id, shift_id) DO UPDATE SET covers=EXCLUDED.covers, updated_at=now()`,
        [zoneIds.get(row.zone), shiftIds.get(row.shift), row.covers],
      );
    }

    for (const host of spec.hosts) {
      const sp = await db.query<{ salesperson_id: string }>(
        `INSERT INTO app.salespeople (client_id, name, phone_e164, languages) VALUES ($1, $2, $3, $4::text[])
         ON CONFLICT (client_id, phone_e164) DO UPDATE SET name=EXCLUDED.name, active=true, updated_at=now()
         RETURNING salesperson_id`,
        [clientId, host.name, host.phoneE164, spec.languages],
      );
      await db.query(
        `INSERT INTO app.salesperson_projects (salesperson_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [sp.rows[0]!.salesperson_id, projectId],
      );
    }

    await db.query(
      `INSERT INTO edge_client_channels (phone_number_id, client_record_id, client_id, company_name, active, config_version, direct_send_enabled, graph_phone_number_id)
       VALUES ($1, $2, $3, $4, true, $5, $6, $1)
       ON CONFLICT (phone_number_id) DO UPDATE SET client_record_id=EXCLUDED.client_record_id, client_id=EXCLUDED.client_id,
         company_name=EXCLUDED.company_name, active=true, config_version=EXCLUDED.config_version,
         direct_send_enabled=EXCLUDED.direct_send_enabled, graph_phone_number_id=EXCLUDED.graph_phone_number_id, updated_at=now()`,
      [spec.whatsapp.phoneNumberId, spec.clientRecordId, clientId, spec.companyName, published.versionKey, spec.whatsapp.directSendEnabled],
    );
    return { clientId, projectId, versionKey: published.versionKey };
  });
}

function parseArgs(argv: string[]): { spec: string; validateOnly: boolean } {
  let spec = '';
  let validateOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--validate-only') validateOnly = true;
    else if (arg === '--spec' && argv[i + 1]) spec = argv[++i] ?? '';
    else throw new Error(`Unknown argument: ${arg}\nUsage: npm run tenant:hospitality -- --spec <file.json> [--validate-only]`);
  }
  if (!spec || /[\u0000-\u001f\u007f]/.test(spec)) throw new Error('--spec <file.json> is required');
  return { spec, validateOnly };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { spec, validateOnly } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(spec, 'utf8')) as unknown;
  if (validateOnly) {
    specSchema.parse(raw);
    console.log('Spec is valid.');
  } else {
    const result = await provisionHospitalityTenant(raw);
    console.log(JSON.stringify(result, null, 2));
    const { closePool } = await import('../src/db/pool.js');
    await closePool();
  }
}
