import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

describe('shell scripts', () => {
  it('parse with bash before operator use', () => {
    for (const script of [
      'scripts/generate-env.sh',
      'scripts/verify-deployment.sh',
      'scripts/shadow-sequence.sh',
      'scripts/backup/backup-postgres.sh',
      'scripts/backup/restore-postgres.sh',
      'scripts/backup/verify-restore.sh',
      'scripts/ops/inspect-dump-metadata.sh',
      'scripts/ops/restore-dump-smoke.sh',
      'scripts/ops/scan-tracked-artifacts.sh',
    ]) {
      execFileSync('bash', ['-n', script], { stdio: 'pipe' });
    }
  });
});
