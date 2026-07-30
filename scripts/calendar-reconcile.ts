import { pathToFileURL } from 'node:url';
import { closePool } from '../src/db/pool.js';
import { CalendarReconciliationService } from '../src/worker/calendar-reconciliation.js';

type ParsedArgs =
  | { command: 'list'; limit: number }
  | { command: 'confirm'; outboxCommandId: string; providerEventId: string; operatorId?: string }
  | { command: 'fail'; outboxCommandId: string; reason: string; operatorId?: string };

function valueArg(argv: string[], name: string): string {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

function optionalValueArg(argv: string[], name: string): string | undefined {
  const value = valueArg(argv, name);
  return value ? value : undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] || 'list';
  if (command === 'list') {
    const limit = Number(valueArg(argv, '--limit') || 50);
    return { command, limit: Number.isFinite(limit) ? limit : 50 };
  }
  const outboxCommandId = valueArg(argv, '--outbox-command-id');
  if (!outboxCommandId) {
    throw new Error('Usage: npm run calendar:reconcile -- <list|confirm|fail> --outbox-command-id=<uuid>');
  }
  const operatorId = optionalValueArg(argv, '--operator-id');
  if (command === 'confirm') {
    const providerEventId = valueArg(argv, '--provider-event-id');
    if (!providerEventId) {
      throw new Error('Usage: npm run calendar:reconcile -- confirm --outbox-command-id=<uuid> --provider-event-id=<event-id>');
    }
    return operatorId
      ? { command, outboxCommandId, providerEventId, operatorId }
      : { command, outboxCommandId, providerEventId };
  }
  if (command === 'fail') {
    const reason = valueArg(argv, '--reason');
    if (!reason) {
      throw new Error('Usage: npm run calendar:reconcile -- fail --outbox-command-id=<uuid> --reason=<reason>');
    }
    return operatorId
      ? { command, outboxCommandId, reason, operatorId }
      : { command, outboxCommandId, reason };
  }
  throw new Error(`Unknown calendar reconciliation command: ${command}`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const service = new CalendarReconciliationService();
  if (args.command === 'list') {
    const ambiguous = await service.listAmbiguous(args.limit);
    console.log(JSON.stringify({ ok: true, ambiguous }, null, 2));
    return;
  }
  if (args.command === 'confirm') {
    const result = await service.confirmCreated(args);
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    return;
  }
  const result = await service.markCreateFailed(args);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Calendar reconciliation failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
