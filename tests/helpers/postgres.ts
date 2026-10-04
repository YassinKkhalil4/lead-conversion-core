import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

function commandExists(command: string): boolean {
  try {
    execFileSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * `describe` for suites that start a throwaway PostgreSQL with `initdb`.
 *
 * Without the Postgres binaries the suite is skipped, which is convenient on a
 * laptop and dangerous in CI: a build with no Postgres would be green while
 * running none of the SQL, queue or dashboard tests. Set REQUIRE_PG_TESTS=1
 * (CI does) and a missing binary fails the run instead.
 */
export type SuiteRegistrar = (name: string, factory: () => void) => void;

export function describePostgres(commands: readonly string[]): SuiteRegistrar {
  const missing = commands.filter((command) => !commandExists(command));
  if (missing.length === 0) return (name, factory) => describe(name, factory);
  if (process.env.REQUIRE_PG_TESTS === '1') {
    return (name) => {
      describe(name, () => {
        it('has the PostgreSQL binaries it needs', () => {
          throw new Error(`REQUIRE_PG_TESTS=1 but these commands are not on PATH: ${missing.join(', ')}`);
        });
      });
    };
  }
  return (name, factory) => describe.skip(name, factory);
}
