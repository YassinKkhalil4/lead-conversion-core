import { pathToFileURL } from 'node:url';
import { closePool } from '../src/db/pool.js';
import { DecommissionReadinessService, type DecommissionReadinessOptions } from '../src/services/decommission-readiness-service.js';

function numberArg(argv: string[], name: string): number | undefined {
  const value = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid numeric argument: ${name}`);
  return parsed;
}

function parseArgs(argv: string[]): DecommissionReadinessOptions {
  const options: DecommissionReadinessOptions = {};
  const directStabilityDays = numberArg(argv, '--direct-stability-days');
  const minCompletedEdgeQualifications = numberArg(argv, '--min-completed-edge-qualifications');
  if (directStabilityDays !== undefined) options.directStabilityDays = directStabilityDays;
  if (minCompletedEdgeQualifications !== undefined) options.minCompletedEdgeQualifications = minCompletedEdgeQualifications;
  if (argv.includes('--owner-approved-n8n')) options.ownerApprovedN8n = true;
  if (argv.includes('--owner-approved-typebot')) options.ownerApprovedTypebot = true;
  if (argv.includes('--owner-approved-airtable')) options.ownerApprovedAirtable = true;
  if (argv.includes('--final-legacy-export-complete')) options.finalLegacyExportComplete = true;
  if (argv.includes('--final-airtable-export-complete')) options.finalAirtableExportComplete = true;
  if (argv.includes('--appointment-media-migrated')) options.appointmentMediaMigrated = true;
  if (argv.includes('--airtable-projection-only-verified')) options.airtableProjectionOnlyVerified = true;
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
