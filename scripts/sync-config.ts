import { pathToFileURL } from 'node:url';
import { logger } from '../src/config/logger.js';
import { closePool } from '../src/db/pool.js';
import { ConfigSyncService } from '../src/services/config-sync-service.js';

function rejectUnsafeText(name: string, value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid sync-config argument: ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Missing sync-config argument: ${name}`);
  return trimmed;
}

export function parseArgs(argv: string[]): { clientRecordId: string | null } {
  let clientRecordId: string | null = null;
  for (const arg of argv) {
    if (/[\u0000-\u001f\u007f]/.test(arg)) throw new Error('Invalid sync-config argument');
    if (arg.startsWith('--client-record-id=')) {
      if (clientRecordId !== null) throw new Error('Duplicate sync-config argument: --client-record-id');
      clientRecordId = rejectUnsafeText('--client-record-id', arg.slice('--client-record-id='.length));
      continue;
    }
    throw new Error('Unknown sync-config argument');
  }
  return { clientRecordId };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { clientRecordId } = parseArgs(argv);
  const config = await new ConfigSyncService().sync(clientRecordId);
  logger.info(
    { version: config.version, clientRecordId, questions: config.questions.length },
    'Configuration synced',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
    .catch((error) => {
      logger.error({ error }, 'Configuration sync failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
