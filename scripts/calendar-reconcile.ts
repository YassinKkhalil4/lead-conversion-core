import { pathToFileURL } from 'node:url';
import { closePool } from '../src/db/pool.js';
import { CalendarReconciliationService } from '../src/worker/calendar-reconciliation.js';

type ParsedArgs =
  | { command: 'list'; limit: number }
  | { command: 'confirm'; outboxCommandId: string; providerEventId: string; operatorId?: string }
  | { command: 'fail'; outboxCommandId: string; reason: string; operatorId?: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseNumberArg(name: string, value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid numeric calendar reconciliation argument: ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid numeric calendar reconciliation argument: ${name}`);
  return parsed;
}

function rejectUnsafeText(name: string, value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid calendar reconciliation argument: ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Missing calendar reconciliation argument: ${name}`);
  return trimmed;
}

function parseKeyValueArgs(argv: string[], allowed: Set<string>): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const arg of argv) {
    const separator = arg.indexOf('=');
    if (separator < 0) throw new Error(`Unknown calendar reconciliation argument: ${arg}`);
    const name = arg.slice(0, separator);
    const value = arg.slice(separator + 1);
    if (!allowed.has(name)) throw new Error(`Unknown calendar reconciliation argument: ${arg}`);
    if (parsed.has(name)) throw new Error(`Duplicate calendar reconciliation argument: ${name}`);
    parsed.set(name, value);
  }
  return parsed;
}

function requiredArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined) throw new Error(`Missing calendar reconciliation argument: ${name}`);
  return value;
}

function optionalTextArg(args: Map<string, string>, name: string): string | undefined {
  const value = args.get(name);
  return value === undefined ? undefined : rejectUnsafeText(name, value);
}

function requiredUuidArg(args: Map<string, string>, name: string): string {
  const value = rejectUnsafeText(name, requiredArg(args, name));
  if (!uuidPattern.test(value)) throw new Error(`Invalid calendar reconciliation argument: ${name}`);
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0]?.startsWith('--') ? 'list' : argv[0] || 'list';
  const rest = argv[0]?.startsWith('--') ? argv : argv.slice(1);
  if (command === 'list') {
    const args = parseKeyValueArgs(rest, new Set(['--limit']));
    const limitValue = args.get('--limit');
    const limit = limitValue === undefined ? 50 : parseNumberArg('--limit', limitValue);
    if (limit > 500) throw new Error('Invalid numeric calendar reconciliation argument: --limit');
    return { command, limit };
  }
  if (command === 'confirm') {
    const args = parseKeyValueArgs(rest, new Set(['--outbox-command-id', '--provider-event-id', '--operator-id']));
    const outboxCommandId = requiredUuidArg(args, '--outbox-command-id');
    const providerEventId = rejectUnsafeText('--provider-event-id', requiredArg(args, '--provider-event-id'));
    const operatorId = optionalTextArg(args, '--operator-id');
    return operatorId
      ? { command, outboxCommandId, providerEventId, operatorId }
      : { command, outboxCommandId, providerEventId };
  }
  if (command === 'fail') {
    const args = parseKeyValueArgs(rest, new Set(['--outbox-command-id', '--reason', '--operator-id']));
    const outboxCommandId = requiredUuidArg(args, '--outbox-command-id');
    const reason = rejectUnsafeText('--reason', requiredArg(args, '--reason'));
    if (reason.length > 4000) throw new Error('Invalid calendar reconciliation argument: --reason');
    const operatorId = optionalTextArg(args, '--operator-id');
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
