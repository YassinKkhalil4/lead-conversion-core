import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
      'scripts/backup/sha256-file.sh',
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

  it('rejects env values that decode to NUL or newline characters', () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-control-env.'));
    try {
      const nulEnvFile = join(root, 'nul.env');
      const newlineEnvFile = join(root, 'newline.env');
      writeFileSync(nulEnvFile, 'EDGE_SHARED_SECRET="prefix\\0suffix"\n');
      writeFileSync(newlineEnvFile, 'EDGE_SHARED_SECRET="prefix\\nsuffix"\n');

      for (const envFile of [nulEnvFile, newlineEnvFile]) {
        expect(() => execFileSync('python3', ['scripts/ops/read-env-file.py', envFile], { stdio: 'pipe' }))
          .toThrow(/Environment values must not contain NUL or newline characters/);
      }
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

  it('computes backup checksums through the portable helper', () => {
    const root = mkdtempSync(join(tmpdir(), 'lead-core-checksum.'));
    try {
      const payload = join(root, 'payload.dump.enc');
      writeFileSync(payload, 'backup-payload');

      const expected = createHash('sha256').update('backup-payload').digest('hex');
      const actual = execFileSync('sh', ['scripts/backup/sha256-file.sh', payload], { encoding: 'utf8' }).trim();

      expect(actual).toBe(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires checksum verification before encrypted restore', () => {
    const backup = readFileSync('scripts/backup/backup-postgres.sh', 'utf8');
    const restore = readFileSync('scripts/backup/restore-postgres.sh', 'utf8');

    expect(backup).toContain('checksum_value="$(scripts/backup/sha256-file.sh "$encrypted_dump")"');
    expect(backup).toContain('printf \'%s  %s\\n\' "$checksum_value" "$(basename "$encrypted_dump")" > "$checksum_file"');
    expect(backup).not.toContain('sha256sum "$encrypted_dump" > "$checksum_file"');
    expect(restore).toContain(': "${RESTORE_SKIP_CHECKSUM:=false}"');
    expect(restore).toContain('checksum_path="${ENCRYPTED_DUMP_SHA256_PATH:-$ENCRYPTED_DUMP_PATH.sha256}"');
    expect(restore).toContain('Set RESTORE_SKIP_CHECKSUM=true only for an intentional unchecked restore');
    expect(restore).toContain("grep -Eq '^[0-9a-fA-F]{64}$'");
    expect(restore).toContain('actual_checksum="$(scripts/backup/sha256-file.sh "$ENCRYPTED_DUMP_PATH")"');
    expect(restore).toContain('Backup checksum mismatch; refusing to restore encrypted dump');
    expect(restore.indexOf('actual_checksum="$(scripts/backup/sha256-file.sh "$ENCRYPTED_DUMP_PATH")"'))
      .toBeLessThan(restore.indexOf('openssl enc -d -aes-256-cbc'));
  });

  it('refuses to overwrite backup outputs when timestamped names collide', () => {
    const backup = readFileSync('scripts/backup/backup-postgres.sh', 'utf8');

    expect(backup).toContain('output_lock="$encrypted_dump.lock"');
    expect(backup).toContain('if ! mkdir "$output_lock"; then');
    expect(backup).toContain('Backup output lock already exists');
    expect(backup).toContain('if [ -e "$encrypted_dump" ] || [ -e "$checksum_file" ]; then');
    expect(backup).toContain('refusing to overwrite');
    expect(backup).toContain('output_paths_reserved="true"');
    expect(backup).toContain('backup_complete="true"');
    expect(backup).toContain('rm -f "$encrypted_dump" "$checksum_file"');
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

  it('fails calendar reconciliation CLI commands on ambiguous operator arguments before querying PostgreSQL', async () => {
    Object.assign(process.env, cliEnv);
    const { parseArgs: parseCalendarReconcileArgs } = await import('../scripts/calendar-reconcile.js');
    const validOutboxId = '11111111-1111-4111-8111-111111111111';

    expect(parseCalendarReconcileArgs([])).toEqual({ command: 'list', limit: 50 });
    expect(parseCalendarReconcileArgs(['list', '--limit=25'])).toEqual({ command: 'list', limit: 25 });
    expect(parseCalendarReconcileArgs(['--limit=25'])).toEqual({ command: 'list', limit: 25 });
    expect(parseCalendarReconcileArgs([
      'confirm',
      `--outbox-command-id=${validOutboxId}`,
      '--provider-event-id=google-event-1',
      '--operator-id=ops-calendar',
    ])).toEqual({
      command: 'confirm',
      outboxCommandId: validOutboxId,
      providerEventId: 'google-event-1',
      operatorId: 'ops-calendar',
    });

    expect(() => parseCalendarReconcileArgs(['list', '--limit=1.5'])).toThrow(/Invalid numeric calendar reconciliation argument/);
    expect(() => parseCalendarReconcileArgs(['list', '--limit=0'])).toThrow(/Invalid numeric calendar reconciliation argument/);
    expect(() => parseCalendarReconcileArgs(['list', '--limit=501'])).toThrow(/Invalid numeric calendar reconciliation argument/);
    expect(() => parseCalendarReconcileArgs(['list', '--limit=9007199254740993'])).toThrow(/Invalid numeric calendar reconciliation argument/);
    expect(() => parseCalendarReconcileArgs(['list', '--limit=10', '--limit=20'])).toThrow(/Duplicate calendar reconciliation argument/);
    expect(() => parseCalendarReconcileArgs(['confirm', '--outbox-command-id=not-a-uuid', '--provider-event-id=google-event-1'])).toThrow(/Invalid calendar reconciliation argument: --outbox-command-id/);
    expect(() => parseCalendarReconcileArgs(['confirm', `--outbox-command-id=${validOutboxId}`, '--provider-event-id=google-event-1', '--unknown=1'])).toThrow(/Unknown calendar reconciliation argument/);
    expect(() => parseCalendarReconcileArgs(['confirm', `--outbox-command-id=${validOutboxId}`, '--provider-event-id=google-event\n1'])).toThrow(/Invalid calendar reconciliation argument: --provider-event-id/);
    expect(() => parseCalendarReconcileArgs(['confirm', `--outbox-command-id=${validOutboxId}`, '--provider-event-id=google-event-1\n'])).toThrow(/Invalid calendar reconciliation argument: --provider-event-id/);
    expect(() => parseCalendarReconcileArgs(['fail', `--outbox-command-id=${validOutboxId}`, '--reason='])).toThrow(/Missing calendar reconciliation argument: --reason/);
    expect(() => parseCalendarReconcileArgs(['fail', `--outbox-command-id=${validOutboxId}`, '--reason=operator verified', '--operator-id=ops\ncalendar'])).toThrow(/Invalid calendar reconciliation argument: --operator-id/);
  });

  it('fails versioned configuration CLI commands on ambiguous operator arguments before querying PostgreSQL', async () => {
    Object.assign(process.env, cliEnv);
    const { parseArgs: parseConfigArgs } = await import('../scripts/config.js');

    expect(parseConfigArgs([], 'config/seed-real-estate.json')).toMatchObject({
      command: 'validate',
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      airtableExportDir: '',
      clientRecordId: null,
      actor: 'operator',
    });
    expect(parseConfigArgs(['publish', '--input=config/seed-real-estate.json', '--client-record-id=recCLIENT01', '--actor=ops-config'], 'config/default.json')).toMatchObject({
      command: 'publish',
      sourcePath: join(process.cwd(), 'config/seed-real-estate.json'),
      clientRecordId: 'recCLIENT01',
      actor: 'ops-config',
    });
    expect(parseConfigArgs(['rollback', '--version=version-1', '--actor=ops-config'], 'config/default.json')).toMatchObject({
      command: 'rollback',
      versionKey: 'version-1',
      actor: 'ops-config',
    });

    expect(() => parseConfigArgs(['publish', '--input=config/a.json', '--airtable-export=exports/config'], 'config/default.json')).toThrow(/config_source_argument_conflict/);
    expect(() => parseConfigArgs(['publish', '--input=config/a.json', '--input=config/b.json'], 'config/default.json')).toThrow(/Duplicate config argument/);
    expect(() => parseConfigArgs(['rollback'], 'config/default.json')).toThrow(/rollback_requires_--version/);
    expect(() => parseConfigArgs(['active', '--actor=ops-config'], 'config/default.json')).toThrow(/Unknown config argument/);
    expect(() => parseConfigArgs(['validate', '--actor=ops-config'], 'config/default.json')).toThrow(/Unknown config argument/);
    expect(() => parseConfigArgs(['publish', '--actor=ops\nconfig'], 'config/default.json')).toThrow(/Invalid config argument: --actor/);
    expect(() => parseConfigArgs(['publish', '--actor=ops-config\n'], 'config/default.json')).toThrow(/Invalid config argument: --actor/);
    expect(() => parseConfigArgs(['publish', '--client-record-id='], 'config/default.json')).toThrow(/Missing config argument: --client-record-id/);
    expect(() => parseConfigArgs(['delete', '--version=version-1'], 'config/default.json')).toThrow(/unknown_config_command:delete/);
  });

  it('fails legacy Airtable configuration sync CLI commands on ambiguous operator arguments before service use', async () => {
    Object.assign(process.env, cliEnv);
    const { parseArgs: parseSyncConfigArgs } = await import('../scripts/sync-config.js');

    expect(parseSyncConfigArgs([])).toEqual({ clientRecordId: null });
    expect(parseSyncConfigArgs(['--client-record-id=recCLIENT01'])).toEqual({ clientRecordId: 'recCLIENT01' });

    expect(() => parseSyncConfigArgs(['recCLIENT01'])).toThrow(/Unknown sync-config argument/);
    expect(() => parseSyncConfigArgs(['--client-record-id=recCLIENT01', '--client-record-id=recCLIENT02'])).toThrow(/Duplicate sync-config argument/);
    expect(() => parseSyncConfigArgs(['--client-record-id='])).toThrow(/Missing sync-config argument: --client-record-id/);
    expect(() => parseSyncConfigArgs(['--client-record-id=recCLIENT01\n'])).toThrow(/Invalid sync-config argument/);
    expect(() => parseSyncConfigArgs(['--unknown=recCLIENT01'])).toThrow(/Unknown sync-config argument/);
  });
});
