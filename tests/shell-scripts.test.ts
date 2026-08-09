import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shell scripts', () => {
  const cliEnv = {
    ...process.env,
    DATABASE_URL: 'postgresql://127.0.0.1:1/unused',
    EDGE_SHARED_SECRET: 'test_shared_secret_123456',
    EDGE_INTERNAL_SECRET: 'test_internal_secret_123456',
  };

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
    execFileSync('python3', [
      '-c',
      "from pathlib import Path; compile(Path('scripts/ops/read-env-file.py').read_text(), 'scripts/ops/read-env-file.py', 'exec')",
    ], { stdio: 'pipe' });
  });

  it('keeps shadow sequence secrets out of curl process arguments', () => {
    const script = readFileSync('scripts/shadow-sequence.sh', 'utf8');
    expect(script).not.toContain('set -a');
    expect(script).not.toContain('set +a');
    expect(script).not.toContain('source .env');
    expect(script).not.toContain('-H "X-Edge-Secret: $EDGE_SHARED_SECRET"');
    expect(script).not.toContain("-H 'X-Edge-Secret: $EDGE_SHARED_SECRET'");
    expect(script).toContain('-H "@$tmp_edge_header"');
    expect(script).toContain('python3 scripts/ops/read-env-file.py "$file"');
    expect(script).toContain('chmod 600 "$tmp_assignments"');
    expect(script).toContain('SHADOW_SEQUENCE_RUN_ID="${SHADOW_SEQUENCE_RUN_ID:-$(date +%s)-$$-${RANDOM:-0}}"');
    expect(script).not.toContain('local event="sequence-$(date +%s)-$COUNTER"');
  });

  it('loads env files without executing shell command substitutions', () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-safe-env.'));
    try {
      const marker = join(root, 'executed');
      const envFile = join(root, 'operator.env');
      writeFileSync(envFile, [
        '# verifier env',
        'DIRECT_LEAD_INGRESS_ENABLED=true',
        `EDGE_SHARED_SECRET=$(touch ${marker})`,
        'QUOTED_VALUE="hello world"',
        'INLINE_COMMENT=value # ignored',
        'export EXPORTED_VALUE=ok',
      ].join('\n'));

      const output = execFileSync('python3', ['scripts/ops/read-env-file.py', envFile]);
      const assignments = output.toString('utf8').split('\0').filter(Boolean);

      expect(assignments).toContain('DIRECT_LEAD_INGRESS_ENABLED=true');
      expect(assignments).toContain(`EDGE_SHARED_SECRET=$(touch ${marker})`);
      expect(assignments).toContain('QUOTED_VALUE=hello world');
      expect(assignments).toContain('INLINE_COMMENT=value');
      expect(assignments).toContain('EXPORTED_VALUE=ok');
      expect(() => readFileSync(marker, 'utf8')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate env keys before operator scripts can use ambiguous values', () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-duplicate-env.'));
    try {
      const envFile = join(root, 'operator.env');
      writeFileSync(envFile, [
        'DIRECT_META_WEBHOOK_ENABLED=false',
        'DIRECT_META_WEBHOOK_ENABLED=true',
      ].join('\n'));

      expect(() => execFileSync('python3', ['scripts/ops/read-env-file.py', envFile], { stdio: 'pipe' }))
        .toThrow(/Duplicate environment key on line 2: DIRECT_META_WEBHOOK_ENABLED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps generated env secrets out of Python process arguments', () => {
    const script = readFileSync('scripts/generate-env.sh', 'utf8');
    expect(script).not.toContain('python3 - "$DB_PASSWORD" "$EDGE_SECRET" "$INTERNAL_SECRET"');
    expect(script).toContain('python3 - "$db_password_file" "$edge_secret_file" "$internal_secret_file"');
    expect(script).toContain('unset DB_PASSWORD EDGE_SECRET INTERNAL_SECRET');
  });

  it('generates a local env file from private temporary secret files', () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-generate-env.'));
    try {
      mkdirSync(join(root, 'scripts'));
      copyFileSync('scripts/generate-env.sh', join(root, 'scripts/generate-env.sh'));
      copyFileSync('.env.example', join(root, '.env.example'));

      execFileSync('bash', ['scripts/generate-env.sh'], { cwd: root, stdio: 'pipe' });

      const generated = readFileSync(join(root, '.env'), 'utf8');
      expect(generated).toContain('EDGE_POSTGRES_PASSWORD=');
      expect(generated).toContain('DATABASE_URL=postgresql://lead_os_edge_app:');
      expect(generated).toContain('EDGE_SHARED_SECRET=');
      expect(generated).toContain('EDGE_INTERNAL_SECRET=');
      expect(generated).not.toContain('replace-with-secret');
      expect(generated).not.toContain('replace-with-at-least-16-chars');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it('does not mutate configuration from the API container startup command', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');
    expect(compose).toContain('lead-core-api:');
    expect(compose).not.toContain('seed:prod && npm start');
    expect(compose).toContain('command: ["npm", "start"]');
  });

  it('keeps production build output scoped to runtime code and scripts', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    const buildConfig = readFileSync('tsconfig.build.json', 'utf8');

    expect(packageJson).toContain('"build": "rm -rf dist && tsc -p tsconfig.build.json"');
    expect(dockerfile).toContain('COPY tsconfig.build.json ./');
    expect(dockerfile).not.toContain('COPY tests ./tests');
    expect(buildConfig).toContain('"include": ["src/**/*.ts", "scripts/**/*.ts"]');
    expect(buildConfig).toContain('"exclude": ["node_modules", "dist", "tests"]');
  });

  it('fails readiness CLI commands on unknown operator arguments before querying PostgreSQL', async () => {
    Object.assign(process.env, cliEnv);
    const [{ parseArgs: parseCutoverReadinessArgs }, { parseArgs: parseDecommissionReadinessArgs }] = await Promise.all([
      import('../scripts/cutover-readiness.js'),
      import('../scripts/decommission-readiness.js'),
    ]);

    expect(() => parseCutoverReadinessArgs(['--max-pending-inbox-typo=0'])).toThrow(/Unknown cutover readiness argument/);
    expect(() => parseDecommissionReadinessArgs(['--owner-approved-n8n-typo'])).toThrow(/Unknown decommission readiness argument/);
  });

  it('fails readiness CLI commands on malformed numeric operator arguments before querying PostgreSQL', async () => {
    Object.assign(process.env, cliEnv);
    const [{ parseArgs: parseCutoverReadinessArgs }, { parseArgs: parseDecommissionReadinessArgs }] = await Promise.all([
      import('../scripts/cutover-readiness.js'),
      import('../scripts/decommission-readiness.js'),
    ]);

    expect(() => parseCutoverReadinessArgs(['--max-pending-inbox'])).toThrow(/Invalid numeric argument/);
    expect(() => parseDecommissionReadinessArgs(['--direct-stability-days='])).toThrow(/Invalid numeric argument/);
    expect(() => parseCutoverReadinessArgs(['--max-queue-age-seconds=0.5'])).toThrow(/Invalid numeric argument/);
    expect(() => parseDecommissionReadinessArgs(['--direct-stability-days=1.5'])).toThrow(/Invalid numeric argument/);
    expect(() => parseCutoverReadinessArgs(['--max-pending-outbox=1e3'])).toThrow(/Invalid numeric argument/);
    expect(() => parseDecommissionReadinessArgs(['--max-worker-heartbeat-age-seconds=0x10'])).toThrow(/Invalid numeric argument/);
    expect(() => parseCutoverReadinessArgs(['--max-pending-inbox= 1'])).toThrow(/Invalid numeric argument/);
    expect(() => parseCutoverReadinessArgs(['--max-pending-inbox=9007199254740993'])).toThrow(/Invalid numeric argument/);
    expect(() => parseDecommissionReadinessArgs(['--min-completed-edge-qualifications=9007199254740993'])).toThrow(/Invalid numeric argument/);
  });
});
