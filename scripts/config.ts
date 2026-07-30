import { resolve } from 'node:path';
import { getEnv } from '../src/config/env.js';
import { closePool } from '../src/db/pool.js';
import { VersionedConfigService } from '../src/configuration/versioned-config-service.js';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'validate';
  const sourcePath = resolve(process.cwd(), argValue('input') || getEnv().SEED_CONFIG_PATH);
  const clientRecordId = argValue('client-record-id') ?? null;
  const actor = argValue('actor') || 'operator';
  const service = new VersionedConfigService();

  if (command === 'validate') {
    const config = await service.loadAndCompile(sourcePath, clientRecordId);
    console.log(JSON.stringify(service.validate(config), null, 2));
    return;
  }
  if (command === 'diff') {
    console.log(JSON.stringify(await service.diff(sourcePath, clientRecordId), null, 2));
    return;
  }
  if (command === 'publish') {
    console.log(JSON.stringify(await service.publish({
      sourcePath,
      clientRecordId,
      publishedBy: actor,
    }), null, 2));
    return;
  }

  throw new Error(`unknown_config_command:${command}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
