import { pathToFileURL } from 'node:url';
import { closePool } from '../src/db/pool.js';
import { DecommissionReadinessService, type DecommissionReadinessOptions } from '../src/services/decommission-readiness-service.js';

const numericArguments = new Set([
  '--direct-stability-days',
  '--min-completed-edge-qualifications',
  '--max-worker-heartbeat-age-seconds',
]);

const booleanArguments = new Set([
  '--owner-approved-n8n',
  '--owner-approved-typebot',
  '--owner-approved-airtable',
  '--final-legacy-export-complete',
  '--final-airtable-export-complete',
  '--appointment-media-migrated',
  '--airtable-projection-only-verified',
]);

function parseNumberArg(name: string, value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid numeric argument: ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid numeric argument: ${name}`);
  return parsed;
}

export function parseArgs(argv: string[]): DecommissionReadinessOptions {
  const options: DecommissionReadinessOptions = {};
  for (const arg of argv) {
    const separator = arg.indexOf('=');
    const name = separator >= 0 ? arg.slice(0, separator) : arg;
    const value = separator >= 0 ? arg.slice(separator + 1) : '';
    if (numericArguments.has(name)) {
      if (separator < 0 || value === '') throw new Error(`Invalid numeric argument: ${name}`);
      const parsed = parseNumberArg(name, value);
      if (name === '--direct-stability-days') options.directStabilityDays = parsed;
      if (name === '--min-completed-edge-qualifications') options.minCompletedEdgeQualifications = parsed;
      if (name === '--max-worker-heartbeat-age-seconds') options.maxWorkerHeartbeatAgeSeconds = parsed;
      continue;
    }
    if (!booleanArguments.has(name) || separator >= 0) throw new Error(`Unknown decommission readiness argument: ${arg}`);
    if (name === '--owner-approved-n8n') options.ownerApprovedN8n = true;
    if (name === '--owner-approved-typebot') options.ownerApprovedTypebot = true;
    if (name === '--owner-approved-airtable') options.ownerApprovedAirtable = true;
    if (name === '--final-legacy-export-complete') options.finalLegacyExportComplete = true;
    if (name === '--final-airtable-export-complete') options.finalAirtableExportComplete = true;
    if (name === '--appointment-media-migrated') options.appointmentMediaMigrated = true;
    if (name === '--airtable-projection-only-verified') options.airtableProjectionOnlyVerified = true;
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const service = new DecommissionReadinessService();
  const report = await service.report(parseArgs(argv));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Decommission readiness failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
