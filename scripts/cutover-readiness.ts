import { pathToFileURL } from 'node:url';
import { closePool } from '../src/db/pool.js';
import { CutoverReadinessService, type CutoverReadinessOptions } from '../src/services/cutover-readiness-service.js';

const numericArguments = new Set([
  '--max-pending-inbox',
  '--max-pending-outbox',
  '--max-pending-scheduled-jobs',
  '--max-queue-age-seconds',
  '--max-worker-heartbeat-age-seconds',
]);

function parseNumberArg(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid numeric argument: ${name}`);
  return parsed;
}

export function parseArgs(argv: string[]): CutoverReadinessOptions {
  const options: CutoverReadinessOptions = {};
  for (const arg of argv) {
    const separator = arg.indexOf('=');
    const name = separator >= 0 ? arg.slice(0, separator) : arg;
    const value = separator >= 0 ? arg.slice(separator + 1) : '';
    if (!numericArguments.has(name)) throw new Error(`Unknown cutover readiness argument: ${arg}`);
    if (separator < 0 || value === '') throw new Error(`Invalid numeric argument: ${name}`);
    const parsed = parseNumberArg(name, value);
    if (name === '--max-pending-inbox') options.maxPendingInbox = parsed;
    if (name === '--max-pending-outbox') options.maxPendingOutbox = parsed;
    if (name === '--max-pending-scheduled-jobs') options.maxPendingScheduledJobs = parsed;
    if (name === '--max-queue-age-seconds') options.maxQueueAgeSeconds = parsed;
    if (name === '--max-worker-heartbeat-age-seconds') options.maxWorkerHeartbeatAgeSeconds = parsed;
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const service = new CutoverReadinessService();
  const report = await service.report(parseArgs(argv));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Cutover readiness failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
