import { pathToFileURL } from 'node:url';
import { closePool } from '../src/db/pool.js';
import { CutoverReadinessService, type CutoverReadinessOptions } from '../src/services/cutover-readiness-service.js';

function numberArg(argv: string[], name: string): number | undefined {
  const value = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid numeric argument: ${name}`);
  return parsed;
}

function parseArgs(argv: string[]): CutoverReadinessOptions {
  const options: CutoverReadinessOptions = {};
  const maxPendingInbox = numberArg(argv, '--max-pending-inbox');
  const maxPendingOutbox = numberArg(argv, '--max-pending-outbox');
  const maxPendingScheduledJobs = numberArg(argv, '--max-pending-scheduled-jobs');
  const maxQueueAgeSeconds = numberArg(argv, '--max-queue-age-seconds');
  const maxWorkerHeartbeatAgeSeconds = numberArg(argv, '--max-worker-heartbeat-age-seconds');
  if (maxPendingInbox !== undefined) options.maxPendingInbox = maxPendingInbox;
  if (maxPendingOutbox !== undefined) options.maxPendingOutbox = maxPendingOutbox;
  if (maxPendingScheduledJobs !== undefined) options.maxPendingScheduledJobs = maxPendingScheduledJobs;
  if (maxQueueAgeSeconds !== undefined) options.maxQueueAgeSeconds = maxQueueAgeSeconds;
  if (maxWorkerHeartbeatAgeSeconds !== undefined) options.maxWorkerHeartbeatAgeSeconds = maxWorkerHeartbeatAgeSeconds;
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
