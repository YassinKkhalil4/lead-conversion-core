import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getEnv } from '../src/config/env.js';
import { closePool } from '../src/db/pool.js';
import { VersionedConfigService } from '../src/configuration/versioned-config-service.js';

type ConfigCommand = 'validate' | 'diff' | 'publish' | 'active' | 'rollback';

export interface ConfigCliArgs {
  command: ConfigCommand;
  sourcePath: string;
  clientRecordId: string | null;
  actor: string;
  versionKey?: string;
}

const commands = new Set<ConfigCommand>(['validate', 'diff', 'publish', 'active', 'rollback']);

function rejectUnsafeText(name: string, value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid config argument: ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Missing config argument: ${name}`);
  return trimmed;
}

function parseKeyValueArgs(argv: string[], allowed: Set<string>): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const arg of argv) {
    const separator = arg.indexOf('=');
    if (separator < 0) throw new Error(`Unknown config argument: ${arg}`);
    const name = arg.slice(0, separator);
    const value = arg.slice(separator + 1);
    if (!allowed.has(name)) throw new Error(`Unknown config argument: ${arg}`);
    if (parsed.has(name)) throw new Error(`Duplicate config argument: ${name}`);
    parsed.set(name, rejectUnsafeText(name, value));
  }
  return parsed;
}

function optionalValue(args: Map<string, string>, name: string): string | undefined {
  return args.get(name);
}

export function parseArgs(argv: string[], defaultSeedConfigPath: string): ConfigCliArgs {
  const command = argv[0]?.startsWith('--') ? 'validate' : argv[0] || 'validate';
  if (!commands.has(command as ConfigCommand)) throw new Error(`unknown_config_command:${command}`);
  const rest = argv[0]?.startsWith('--') ? argv : argv.slice(1);
  const allowedByCommand: Record<ConfigCommand, Set<string>> = {
    validate: new Set(['--input', '--client-record-id']),
    diff: new Set(['--input', '--client-record-id']),
    publish: new Set(['--input', '--client-record-id', '--actor']),
    active: new Set(['--client-record-id']),
    rollback: new Set(['--version', '--client-record-id', '--actor']),
  };
  const args = parseKeyValueArgs(rest, allowedByCommand[command as ConfigCommand]);
  const input = optionalValue(args, '--input');
  const clientRecordId = optionalValue(args, '--client-record-id') ?? null;
  const actor = optionalValue(args, '--actor') || 'operator';
  const versionKey = optionalValue(args, '--version');
  if (command === 'rollback' && !versionKey) throw new Error('rollback_requires_--version');
  return {
    command: command as ConfigCommand,
    sourcePath: resolve(process.cwd(), input || defaultSeedConfigPath),
    clientRecordId,
    actor,
    ...(versionKey ? { versionKey } : {}),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, getEnv().SEED_CONFIG_PATH);
  const service = new VersionedConfigService();

  if (args.command === 'validate') {
    const config = await service.loadAndCompile(args.sourcePath, args.clientRecordId);
    console.log(JSON.stringify(service.validate(config), null, 2));
    return;
  }
  if (args.command === 'diff') {
    console.log(JSON.stringify(await service.diff(args.sourcePath, args.clientRecordId), null, 2));
    return;
  }
  if (args.command === 'publish') {
    console.log(JSON.stringify(await service.publish({
      sourcePath: args.sourcePath,
      clientRecordId: args.clientRecordId,
      publishedBy: args.actor,
    }), null, 2));
    return;
  }
  if (args.command === 'active') {
    console.log(JSON.stringify(await service.getActiveMetadata(service.scopeKey(args.clientRecordId)), null, 2));
    return;
  }
  if (args.command === 'rollback') {
    console.log(JSON.stringify(await service.activateVersion({
      versionKey: args.versionKey || '',
      clientRecordId: args.clientRecordId,
      activatedBy: args.actor,
    }), null, 2));
    return;
  }

  throw new Error(`unknown_config_command:${args.command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
