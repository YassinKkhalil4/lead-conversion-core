# Test Evidence

## 2026-07-30 Baseline From Evidence Copy

Command: `npm test`

Result: failed before executing tests because `vitest` was not installed in the supplied source copy.

Verification level: baseline command only.

Command: `npm run lint`

Result: failed before executing TypeScript because `tsc` was not installed in the supplied source copy.

Verification level: baseline command only.

Command: `diff -rq source/conversation-edge source/lead-conversion-os-active-test-v2/conversation-edge`

Result: no output; duplicate tree matched the canonical edge tree byte-for-byte in the evidence archive.

Verification level: local file inspection.

## 2026-07-30 MP-01 Source Hygiene

Command: `find . -maxdepth 4 \( -name '.env*' -o -name '*.dump' -o -name '*inspect*.json' -o -name '*credentials*' -o -name '*credential*' -o -path './dist/*' -o -path './node_modules/*' \) -print`

Result: no secret-bearing/runtime artifact was copied into the clean repo before dependency install/build. Later `dist/` and `node_modules/` were generated locally and are ignored.

Verification level: local file inspection.

## 2026-07-30 MP-02 Reproducible Node Gates

Command: `npm install --package-lock-only`

Result: lockfile generated. Initial audit found 5 vulnerabilities in the old Vitest/Vite chain.

Command: `npm install --save-dev vitest@latest`

Result: dependency tree updated; `npm audit` later reported zero vulnerabilities.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate`

Result: passed. `npm ci` installed 118 packages, TypeScript lint passed, Vitest ran 15 tests across 2 source suites, build passed, audit found 0 vulnerabilities.

Verification level: implemented and unit tested locally.

## 2026-07-30 MP-02 Migration Verification

Command: disposable local PostgreSQL cluster with `initdb`, `pg_ctl`, `createdb`; then `npm run migrate` twice.

Result: all five migrations applied once and idempotent rerun passed.

Command: manually set `edge_schema_migrations.checksum_sha256='bad-checksum'` for `001_init.sql`; reran `npm run migrate`.

Result: migration failed with checksum mismatch as expected.

Command: two `npm run migrate` processes against a fresh disposable database.

Result: both completed successfully and `edge_schema_migrations` contained exactly 5 rows, verifying advisory-lock-safe concurrent execution locally.

Verification level: local PostgreSQL integration tested.

## 2026-07-30 MP-02 Health, Heartbeat, Seed

Command: start worker with `OUTBOX_WORKER_ENABLED=false` against disposable migrated database.

Result: `runtime.worker_heartbeats` contained `mp02-heartbeat-test` with a non-null heartbeat.

Command: `npm start` against disposable migrated database, then `curl -fsS http://127.0.0.1:18082/ready`.

Result: `/ready` returned `ok=true`, `database=ready`, and latest migration `005_runtime_foundations.sql`.

Command: `npm run seed` against disposable migrated database.

Result: `edge_config_snapshots` contained one seeded config snapshot.

Verification level: local integration tested.

## 2026-07-30 MP-02 Backup And Restore

Command: run `scripts/backup/backup-postgres.sh`, `scripts/backup/restore-postgres.sh`, and `scripts/backup/verify-restore.sh` between disposable local PostgreSQL source and blank restore databases.

Result: encrypted backup was created, restore into blank database succeeded, and verification queries passed.

Verification level: local restore tested.

## 2026-07-30 MP-02 Container/Dump Tooling

Command: `DUMP_PATH=... scripts/ops/inspect-dump-metadata.sh`

Result: blocked because Docker daemon socket was unavailable.

Command: `LEAD_CORE_ENV_FILE=<empty temp file> EDGE_POSTGRES_PASSWORD=<dummy> docker-compose -f docker-compose.yml config`

Result: static Compose validation passed.

Verification level: static config tested; Docker image run and Docker-based dump metadata inspection blocked by local daemon availability.

## 2026-07-30 MP-03 Core Schema

Command: disposable local PostgreSQL cluster; `npm run migrate`

Result: migrations `001` through `006_app_core_schema.sql` applied successfully. New schemas contained 37 tables across `app`, `runtime`, `configuration`, `audit`, and `migration`.

Verification level: local PostgreSQL integration tested.

## 2026-07-30 MP-03 Airtable Importer Dry Run

Command: `npm run import:airtable -- --input=tests/fixtures/airtable-export`

Result: dry-run loaded 4 synthetic records across JSON and CSV files, reported 4 valid records, 0 rejected records, and correctly listed missing tables from the incomplete fixture.

Command: `npm test`

Result: importer dry-run fixture test passed alongside existing engine/migration tests.

Verification level: unit tested and contract-fixture tested locally.

## 2026-07-30 MP-03 Airtable Importer Apply

Command: disposable local PostgreSQL cluster; `npm run migrate`; `npm run import:airtable -- --input=tests/fixtures/airtable-export --apply`

Result: created 1 import run, 4 raw records, 1 client, 1 project, 1 salesperson, 1 contact, 1 lead, and 5 entity-map rows.

Command: reran the same apply command against the same database.

Result: domain entity counts remained 1 client, 1 project, 1 salesperson, 1 contact, 1 lead, and 5 entity-map rows.

Verification level: local PostgreSQL integration tested for initial mappings and idempotent domain upsert.

## 2026-07-30 MP-03 Reconciliation

Command: disposable local PostgreSQL cluster; `npm run migrate`; `npm run import:airtable -- --input=tests/fixtures/airtable-export --apply`; `npm run reconcile:airtable -- --record-results`

Result: reconciliation passed and recorded 7 checks in `migration.reconciliation_results`: rejected records, mapped clients, mapped projects, mapped salespeople, mapped leads, contact phone uniqueness, and lead-contact links.

Verification level: local PostgreSQL integration tested.

## 2026-07-30 MP-03 Expanded Historical Adapters

Command: `npm run lint && npm test`

Result: passed. Vitest included PostgreSQL-backed importer integration tests for idempotent import of clients/projects/salespeople/contacts/leads/qualifications/scores/messages/followups/appointments, missing relationships, and rollback on mid-transaction failure.

Command: disposable local PostgreSQL cluster; `npm run migrate`; `npm run import:airtable -- --input=tests/fixtures/airtable-export --apply`; `npm run reconcile:airtable -- --record-results`

Result: reconciliation passed and recorded 12 checks: rejected records, mapped clients, mapped projects, mapped salespeople, mapped leads, mapped qualifications, mapped scores, mapped messages, mapped followups, mapped appointments, contact phone uniqueness, and lead-contact links.

Verification level: local PostgreSQL integration tested.

## 2026-07-30 Codex Conversion And Audit Gate

Command: `git status --short`

Result: clean before Codex conversion; generated `dist/` and `node_modules/` were ignored.

Command: `git log --oneline --decorate -10`

Result: confirmed current branch head was `d0e751a` on `transition/edge-postgres-core`.

Command: `git show --stat 7ba47c2`, `git show --stat df90f61`, `git show --stat d0e751a`

Result: verified the three recorded commits and file surfaces.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` found 0 vulnerabilities; TypeScript lint passed; 4 Vitest suites and 20 tests passed; build passed; audit found 0 vulnerabilities; smoke test reported 9 questions, 22 options, and 7 messages.

Verification level: implemented and locally verified.

## 2026-07-30 Audit Fixes

Finding: `/ready` reported only the latest migration row and did not prove all required migration files were applied.

Resolution: `/ready` now compares migration files on disk with applied migration rows and reports missing migrations. It also includes worker-heartbeat readiness.

Finding: backup restore verification only checked that queries could run and did not report important counts.

Resolution: `scripts/backup/verify-restore.sh` now enforces a minimum migration count, verifies `runtime.worker_heartbeats`, and reports migration/config/new-schema table counts.

Finding: Airtable importer synthesized missing record IDs from content and row index.

Resolution: missing/duplicate Airtable record IDs are now rejected with actionable reasons.

Finding: relationship and phone failures needed explicit verification.

Resolution: added tests and fixtures for invalid phones, duplicate IDs, missing relationships, idempotent reruns, and rollback after mid-transaction failure.

Verification level: unit tested and local PostgreSQL integration tested.

## 2026-07-30 MP-04 Durable Runtime Foundation

Command: `npm run lint && npm test`

Result: passed. Vitest ran 5 test files and 31 tests, including PostgreSQL-backed runtime integration coverage for duplicate inbound events, deterministic fallback event IDs, concurrent inbox claims, expired inbox lease recovery, retryable inbox rescheduling, inbox dead-lettering, safe inbox replay, atomic business mutation plus outbox insertion, rollback with no outbox record, concurrent outbox claims, expired outbox lease recovery, delivery-unknown handling, increasing bounded retry delay, max-attempt dead-lettering, unique durable job identities, cancelled jobs, runtime worker orchestration, and append-only audit entries.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 5 files and 31 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL integration tested.
