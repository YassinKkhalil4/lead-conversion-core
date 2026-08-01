import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    execFileSync('python3', [
      '-c',
      "from pathlib import Path; compile(Path('scripts/backup/write-pg-service.py').read_text(), 'scripts/backup/write-pg-service.py', 'exec')",
    ], { stdio: 'pipe' });
  });

  it('keeps shadow sequence secrets out of curl process arguments', () => {
    const script = readFileSync('scripts/shadow-sequence.sh', 'utf8');
    expect(script).not.toContain('set -a');
    expect(script).not.toContain('set +a');
    expect(script).not.toContain('-H "X-Edge-Secret: $EDGE_SHARED_SECRET"');
    expect(script).not.toContain("-H 'X-Edge-Secret: $EDGE_SHARED_SECRET'");
    expect(script).toContain('-H "@$tmp_edge_header"');
  });

  it('writes libpq service files from database URLs without using URL arguments', () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-pg-service.'));
    try {
      const urlFile = join(root, 'url.txt');
      const serviceFile = join(root, 'pg_service.conf');
      writeFileSync(urlFile, 'postgresql://lead_user:p%40ssword@127.0.0.1:5433/lead_db?sslmode=require');

      execFileSync('python3', [
        'scripts/backup/write-pg-service.py',
        urlFile,
        serviceFile,
        'lead_core_test',
      ], { stdio: 'pipe' });

      expect(readFileSync(serviceFile, 'utf8')).toBe([
        '[lead_core_test]',
        'host=127.0.0.1',
        'port=5433',
        'dbname=lead_db',
        'user=lead_user',
        'password=p@ssword',
        'sslmode=require',
        '',
      ].join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps backup and restore database URLs out of PostgreSQL tool arguments', () => {
    const backup = readFileSync('scripts/backup/backup-postgres.sh', 'utf8');
    const restore = readFileSync('scripts/backup/restore-postgres.sh', 'utf8');
    const verify = readFileSync('scripts/backup/verify-restore.sh', 'utf8');

    expect(backup).not.toContain('pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL"');
    expect(restore).not.toContain('psql "$RESTORE_TARGET_DATABASE_URL"');
    expect(restore).not.toContain('pg_restore --exit-on-error --dbname="$RESTORE_TARGET_DATABASE_URL"');
    expect(verify).not.toContain('psql "$RESTORE_TARGET_DATABASE_URL"');
    expect(backup).toContain('--dbname="service=lead_core_backup_source"');
    expect(restore).toContain('--dbname="service=lead_core_restore_target"');
    expect(verify).toContain('psql "service=lead_core_restore_target"');
  });
});
