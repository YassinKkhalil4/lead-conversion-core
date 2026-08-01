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

## 2026-07-30 MP-05 Meta WhatsApp Adapter Contract

Command: `npm run lint && npm test`

Result: passed. Vitest ran 6 test files and 37 tests, including sanitized Meta WhatsApp adapter fixtures for disabled configuration, accepted provider response, rate-limit retry with retry hint, validation permanent failure, thrown fetch delivery-unknown classification, and bounded interactive payload generation.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 6 files and 37 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local contract-fixture tested. Live Meta verification remains pending owner action for rotated credentials, template approvals, and staging webhook access.

## 2026-07-30 MP-05 Messaging Outbox Dispatcher

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 41 tests, including dispatcher coverage for mapping accepted provider sends to delivered runtime outcomes, preserving retry hints, rejecting unsupported outbox command types without provider calls, and rejecting malformed WhatsApp send payloads without provider calls.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 41 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local unit and contract-fixture tested. No live provider call was made.

## 2026-07-30 MP-05 Internal Message Request API

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 43 tests, including PostgreSQL-backed coverage that an internal WhatsApp send request creates one idempotent `app.messages` row, one `runtime.outbox_commands` row, and one audit event across duplicate requests. Fastify route injection verified `/internal/messages/whatsapp/send` with `x-internal-secret` persists and enqueues without calling Meta.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 43 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL and API integration tested. No live provider call was made.

## 2026-07-30 MP-05 Template And Session Window Policy

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 45 tests, including policy coverage that expired WhatsApp session messages are rejected before enqueue, unapproved templates are rejected before enqueue, approved templates can enqueue, and Meta template payloads are built from sanitized data.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 45 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API and unit tested. Live template inventory verification remains pending owner action.

## 2026-07-30 MP-05 Meta Status Webhook Ingestion

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 47 tests, including PostgreSQL/API integration coverage for Meta webhook challenge verification, raw-body HMAC signature rejection without durable receipt, signed status webhook durable receipt into `runtime.inbox_events`, duplicate webhook deduplication, runtime inbox worker processing, `app.message_delivery_events` idempotency, outbound `app.messages` state updates, audit recording, and provider-message-id linking after outbox acceptance.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 47 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. Live Meta status webhook verification remains pending owner action.

## 2026-07-30 MP-05 n8n Compatibility Routes

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 49 tests, including PostgreSQL/API integration coverage for `/compat/n8n/messages/whatsapp/send` resolving a legacy Airtable client ID, creating a queued `app.messages` row, creating a pending `runtime.outbox_commands` row without a provider message ID, and `/compat/n8n/messages/whatsapp/status` receiving duplicate status acknowledgements through durable inbox and processing one idempotent delivery event.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 49 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested. No live provider call was made; routes remain behind `N8N_COMPAT_ROUTES_ENABLED`.

## 2026-07-30 MP-06 Versioned Configuration Foundation

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 50 tests, including PostgreSQL integration coverage that the seed configuration validates, diffs from no active config, publishes one immutable `configuration.versions` row, updates `configuration.active_versions`, maintains the legacy active `edge_config_snapshots` compatibility row, idempotently republishes the same version, and rejects mutation of a published configuration row.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 50 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Command: `DATABASE_URL=postgresql://127.0.0.1:1/unused EDGE_SHARED_SECRET=test_shared_secret_123456 EDGE_INTERNAL_SECRET=test_internal_secret_123456 npm run config -- validate --input=config/seed-real-estate.json`

Result: passed. CLI validation returned `ok=true`, version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, checksum `2163da54e79c23e0d79fc3ef58451be23a02d2e311fdff4df5d685ae26408466`, 9 questions, and 7 messages.

Verification level: local PostgreSQL integration tested.

## 2026-07-30 MP-06 Active And Rollback Configuration

Command: `npm run lint && npm test`

Result: passed. Vitest ran 7 test files and 51 tests, including PostgreSQL integration coverage that publishing a changed config moves the active pointer, runtime `ConfigRepository.getActive` reads from `configuration.active_versions`, `npm run config -- rollback --version=<version>` restores the prior published version, both published version rows remain present, and legacy `edge_config_snapshots` remains synchronized as a rollback path.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 7 files and 51 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL integration and CLI rollback tested.

## 2026-07-30 MP-06 Invalid Configuration Fixtures

Command: `npm run lint && npm test`

Result: passed. Vitest ran 8 test files and 53 tests, including a malformed configuration fixture with no active questions that is rejected before publish and a deterministic config diff unit test for added/removed question and message keys.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 53 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local unit and fixture tested.

## 2026-07-30 MP-06 Conversation Configuration Pins

Command: `npm run lint`

Result: passed. TypeScript strict compile completed with no errors after adding configuration metadata snapshots and conversation UUID pins.

Command: `npm test`

Result: passed. Vitest ran 8 test files and 54 tests, including PostgreSQL integration coverage that new legacy `edge_conversations` rows store both `config_version` and `configuration_version_id`, ordinary reruns keep the original pin after active configuration changes, and authenticated bootstrap with `migrateConfig=true` moves both pins together.

Command: `npm run build`

Result: passed.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 54 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested.

## 2026-07-30 MP-06 Airtable Configuration Export Parity

Command: `npm run lint`

Result: passed.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed from commit `89bc46e`. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 15 files and 126 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

## 2026-08-01 Google Calendar Network Classification

Command: `docker info`

Result: failed to connect to `unix:///var/run/docker.sock`; Docker-backed PostgreSQL dump inspection and restore-smoke execution remain blocked by local daemon availability.

Command: `npx vitest run tests/calendar-outbox-dispatcher.test.ts`

Result: passed. Focused calendar tests ran 10 tests covering dispatcher delivery/retry/busy/malformed-payload behavior, required Google credentials, bounded numeric/date Google retry hints, retryable Google free/busy network failures, and `delivery_unknown` Google create-event network failures.

Command: `npm run lint`

Result: passed.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed from commit `d57f153`. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 15 files and 124 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 15 files and 121 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verified commit: `5f78182`

## 2026-08-01 Operator Script Secret Handling

Command: `bash -n scripts/shadow-sequence.sh && bash -n scripts/backup/backup-postgres.sh && bash -n scripts/backup/restore-postgres.sh && bash -n scripts/backup/verify-restore.sh`

Result: passed.

Command: `python3 -c "from pathlib import Path; compile(Path('scripts/backup/write-pg-service.py').read_text(), 'scripts/backup/write-pg-service.py', 'exec')"`

Result: passed.

Command: `npx vitest run tests/shell-scripts.test.ts`

Result: failed on the first run because the static assertion rejected the safe shell variable assignment used before unsetting `RESTORE_TARGET_DATABASE_URL`.

Resolution: narrowed the static assertion to the unsafe PostgreSQL tool argument forms: `psql "$RESTORE_TARGET_DATABASE_URL"`, `pg_restore --dbname="$RESTORE_TARGET_DATABASE_URL"`, and `pg_dump --dbname="$DATABASE_URL"`.

Command: `npx vitest run tests/shell-scripts.test.ts`

Result: passed. Focused shell tests ran 4 tests covering script syntax, shadow sequence curl header secret handling, libpq service-file generation from a PostgreSQL URL, and absence of raw database URL arguments in backup/restore PostgreSQL tool invocations.

Command: `npm run lint`

Result: passed.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 15 files and 120 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Log verification: request logs emitted during the full test run preserved route paths while redacting `hub.verify_token` in both `req.url` and `req.query`; `x-edge-secret`, `x-internal-secret`, and `x-hub-signature-256` headers were also redacted.

## 2026-08-01 Deployment Verifier Curl Secret Handling

Command: `bash -n scripts/verify-deployment.sh`

Result: passed.

Command: `npx vitest run tests/ingress-gating.test.ts`

Result: passed. Focused ingress/deployment-script tests ran 5 tests, including static coverage that `scripts/verify-deployment.sh` no longer exports sourced env values, no longer embeds `EDGE_SHARED_SECRET` directly in curl `-H` arguments, and no longer sends the Meta verify token through the curl URL command argument.

Command: `npm run lint`

Result: passed.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 15 files and 121 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

## 2026-08-01 Request Log Secret Redaction

Command: `npx vitest run tests/logger.test.ts`

Result: failed on the first run because importing the logger singleton required `DATABASE_URL`, `EDGE_SHARED_SECRET`, and `EDGE_INTERNAL_SECRET` before the test could execute.

Command: `npm run lint`

Result: failed on the first run because the raw Pino request serializer needed an explicit type boundary.

Resolution: moved pure redaction helpers and request serialization into `src/config/log-redaction.ts`, imported the serializer from `src/config/logger.ts`, and tested serializer behavior without constructing the environment-backed logger singleton.

Command: `npx vitest run tests/logger.test.ts`

Result: passed. Focused tests ran 3 tests covering Meta `hub.verify_token` URL redaction, generic query credential redaction, authentication/signature header redaction, and the request serializer preserving route evidence while redacting secrets.

Command: `npm run lint`

Result: passed.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: failed for the redaction objective even though the command exited 0: request logs emitted during the test run showed Fastify/Pino serialized `req.query.hub.verify_token` with the test token value, and `req.url` was over-redacted to `**redacted**`.

Resolution: added explicit query-object redaction in the request serializer and removed the broad Pino `req.url` redaction path so routes remain observable while sensitive query values are censored.

Command: `npx vitest run tests/logger.test.ts`

Result: failed on the first serializer-query assertion because the mock request did not include Fastify's parsed query object, so Pino serialized `query` as an empty string.

Resolution: made query redaction tolerate non-object serializer values and updated the serializer test to include a parsed query object.

Command: `npx vitest run tests/logger.test.ts`

Result: passed. Focused tests ran 4 tests covering URL redaction, header redaction, query-object redaction, and the configured request serializer.

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/config-versioning.test.ts`

Result: passed. Focused config tests ran 4 tests, including seed-to-Airtable-export deterministic version parity, CLI `npm run config -- validate --airtable-export=<dir>`, duplicate Airtable config record rejection, missing linked question rejection, and missing message text rejection.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 56 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local unit, CLI, and fixture-generated Airtable export parity tested. Final compatibility with the real Airtable export remains pending owner action.

## 2026-07-30 MP-07 Internal Lead Intake Command

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 23 PostgreSQL/API tests, including authenticated `/internal/leads/intake` coverage for idempotent contact/lead/intake-event upserts, project matching by legacy ID, one first-contact `app.messages` row, one `runtime.outbox_commands` row, one audit event, duplicate replay returning the same durable IDs, and opted-out contact suppression with no outbound message/outbox row.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 58 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested. No live website, Facebook, Airtable, or Meta provider call was made.

## 2026-07-30 MP-07 Durable Lead Source Ingress

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 26 PostgreSQL/API tests, including `/webhooks/leads/website` durable receipt before processing, `/webhooks/leads/facebook` sanitized field-data intake without Graph API calls, processed inbox status, first-contact outbox enqueue for website leads, and invalid website payload durable receipt marked `ignored` without creating authoritative lead state.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 61 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. No live website, Facebook Graph, Airtable, or Meta provider call was made.

## 2026-07-30 MP-07 Airtable Projection Outbox Hook

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 26 PostgreSQL/API tests, including deterministic `airtable.project_lead_visibility` outbox command creation for new lead intake, duplicate intake preserving the same projection command ID, opted-out lead intake still creating only the projection command, and permanent projection command failure preserving the authoritative `app.leads` row.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 61 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested. No live Airtable call was made.

## 2026-07-30 MP-08 Durable Meta Inbound Conversation Bridge

Command: `npm run lint`

Result: passed. TypeScript strict compile completed with no errors after adding the durable inbound message processor and combined Meta inbox processor.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 28 PostgreSQL/API tests, including signed Meta inbound message webhook receipt into `runtime.inbox_events`, worker processing through `MetaInboxProcessor`, edge-owned `edge_conversations` state advancement from `asking_location` to `asking_unit_type`, `app.qualification_answers` persistence, transactional `app.messages` plus `runtime.outbox_commands` reply enqueue, `conversation.inbound_processed` audit recording, and legacy-owned conversation ignore behavior preserving Typebot fallback authority.

Command: `npm ci`

Result: passed. Installed 118 packages from the lockfile, audited 119 packages, and found 0 vulnerabilities.

Command: `npm run lint`

Result: passed.

Command: `npm test`

Result: passed. Vitest ran 8 files and 63 tests, including the new MP-08 inbound conversation coverage and existing MP-01 through MP-07 regression coverage.

Command: `npm run build`

Result: passed.

Command: `npm audit --audit-level=moderate`

Result: passed. Audit found 0 vulnerabilities.

Command: `npm run test:smoke`

Result: passed. Smoke returned `ok=true`, config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized Meta fixtures. No live Meta, Typebot, n8n, or Airtable call was made.

## 2026-07-30 MP-08 Durable Opt-Out And Takeover Handling

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 30 PostgreSQL/API tests, including explicit STOP opt-out processing that updates `edge_conversations`, `edge_lead_controls`, `app.leads`, and `app.contacts`; suppresses `app.messages` and `runtime.outbox_commands`; records a suppressed active turn; and writes `conversation.reply_suppressed` audit metadata. It also covered human-takeover suppression preserving the current question state, recording the control snapshot, and avoiding outbound side effects.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: failed on first run. `npm ci` and lint passed, but `npm test` failed because `tests/config-versioning.test.ts` exceeded Vitest's 5 second timeout while spawning `npm run config` inside the full suite. Resolution: replaced the slow npm wrapper with direct `process.execPath --import tsx scripts/config.ts validate --airtable-export=<dir>` execution, preserving the same CLI script validation.

Command: `npx vitest run tests/config-versioning.test.ts`

Result: passed after the timeout fix. Focused config tests ran 4 tests in 743ms.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed after the timeout fix. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 65 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized Meta fixtures. No live Meta, Typebot, n8n, or Airtable call was made.

## 2026-07-30 MP-08 Durable Qualification Completion

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 32 PostgreSQL/API tests, including English final site-visit completion, Arabic final site-visit completion, `app.qualification_sessions.status='completed'`, session `configuration_version_id` pinning, final `app.qualification_answers` persistence, `app.leads` transition to `qualified`, closing WhatsApp outbox enqueue, and duplicate final-turn replay preserving one message, one outbox command, and one inbound audit event.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 67 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized Meta fixtures. No live Meta, Typebot, n8n, or Airtable call was made.

## 2026-07-30 MP-08 Source-To-App Conversation Projection

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 32 PostgreSQL/API tests, including `app.conversations` upsert by lead, inbound app message projection with Meta provider message IDs, outbound app message linkage to the projected app conversation, qualification session linkage to the projected app conversation, opt-out and human-takeover projection without outbound effects, and duplicate final-turn replay preserving projected row counts.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 67 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized Meta fixtures. No live Meta, Typebot, n8n, or Airtable call was made.

## 2026-07-30 MP-08 n8n-Compatible Inbound Message Receipt

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 33 PostgreSQL/API tests, including authenticated `/compat/n8n/messages/whatsapp/inbound`, duplicate receipt collapsing to one `runtime.inbox_events` row with provider `n8n`, worker processing through `MetaInboxProcessor`, qualification state advancement, inbound/outbound app message projection, and WhatsApp outbox enqueue without direct provider calls.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 8 files and 68 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized n8n fixtures. No live Meta, Typebot, n8n, or Airtable call was made.

## 2026-07-30 MP-09 Scoring Foundation

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/lead-scoring.test.ts`

Result: passed. Scoring unit tests ran 2 tests covering deterministic `real_estate_v1` factors, hot/cold temperature thresholds, missing-answer detection, and stable input hashes across answer object ordering.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: failed on first run. Completed-qualification scoring produced score 35 instead of 99 because the scorer read only persisted `app.qualification_answers`; existing MP-08 completion persisted the final answer row while prior answers were still present in the durable edge conversation snapshot. Resolution: pass `decision.nextState.answers` into `LeadScoringService.scoreLead` from the completion transaction and overlay those answers onto persisted answer rows before scoring.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed after the scoring snapshot fix. Runtime integration ran 34 PostgreSQL/API tests, including qualification completion creating one idempotent `app.score_runs` row, atomic `app.leads.lead_score`/`temperature` update, `lead.scored` audit recording, duplicate inbound replay preserving one score run/audit event, and incomplete qualification data reporting missing answers without inventing values.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 71 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or salesperson-provider call was made.

## 2026-07-30 MP-09 Notification Dispatch

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: passed. Focused tests ran 45 tests, including mapping `salesperson.lead_assignment_notification` to a real WhatsApp provider send command, preserving provider accepted outcomes, rejecting malformed `operator.routing_attention_required` payloads without provider calls, and all runtime salesperson command ingestion coverage.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 78 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local dispatcher contract and PostgreSQL/API integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or salesperson-provider call was made.

## 2026-07-30 MP-10 Follow-Up Scheduling Foundation

Command: `npm run lint`

Result: failed on first run. Optional `correlationId`/`causationId` values were passed as `undefined` in new follow-up cancellation paths under exact optional property types. Resolution: optional fields are now included only when present.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed before the lint fix because runtime behavior was correct, but the TypeScript failure still required correction before commit. Runtime integration ran 40 PostgreSQL/API tests.

Command: `npm run lint`

Result: passed after the optional-field fix.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed after the optional-field fix. Runtime integration ran 40 PostgreSQL/API tests, including semantic follow-up scheduling into `app.followups` and `runtime.scheduled_jobs`, duplicate schedule prevention, explicit timezone persistence, cancellation on lead assignment, and cancellation on salesperson close-lost command.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 79 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or report-recipient provider call was made.

## 2026-07-30 MP-10 Follow-Up Job Execution

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed. Runtime integration ran 43 PostgreSQL/API tests, including due `followup.send` job execution through `RuntimeWorker`, one outbound app message and one runtime outbox command per follow-up, duplicate execution prevention after job completion, cancelled scheduled job non-execution, and expired scheduled-job lease recovery before follow-up send.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 82 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or report-recipient provider call was made.

## 2026-07-30 MP-10 SLA Scheduling And Execution

Command: `npm run lint`

Result: failed on first run. `SlaService` passed optional `correlationId`, `causationId`, and `actorId` values as explicit `undefined` under exact optional property types. Resolution: optional fields are now included only when present.

Command: `npm run lint`

Result: passed after the optional-field fix.

Command: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: failed on first focused run. Due SLA jobs were claimed but the `app.sla_jobs` rows stayed scheduled because the worker retried an SQL error: the SLA processing query used `USING (client_id)` after the left side already exposed `client_id` from multiple tables. Resolution: changed the SLA processing query to explicit joins.

Command: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: passed after the explicit-join fix. Focused tests ran 55 tests, including SLA idempotent assignment scheduling, acknowledgement cancellation, due reminder/escalation execution, expired stale-qualified lease recovery, stale SLA cancellation at execution time, and dispatcher mapping for SLA notification command types.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 88 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API and dispatcher contract integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or report-recipient provider call was made.

## 2026-07-30 MP-10 Daily Reporting Jobs

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: failed on first focused run. The daily report job was claimed but the report row stayed scheduled because the unacknowledged-assignment count query referenced `$2` while leaving `$1` and `$3` unused, so PostgreSQL could not determine the type of `$1`. Resolution: the query now computes active unacknowledged assignments as of the report date, using the report date and timezone parameters explicitly.

Command: `npm run lint`

Result: passed after the report query fix.

Command: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: passed after the report query fix. Focused tests ran 59 tests, including daily report idempotent scheduling, cancelled report non-execution, expired report lease recovery, SQL row-count accuracy, report outbox idempotency, and dispatcher mapping for `operator.daily_report`.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 92 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API and dispatcher contract integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, Google Calendar, or report-recipient provider call was made.

## 2026-07-30 MP-11 Appointment Scheduling Foundation

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/calendar-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: passed. Focused tests ran 57 tests, including appointment offer idempotency independent of slot order, offer cancellation before booking, concurrent booking of one slot producing one appointment, duplicate booking replay returning the original appointment/outbox IDs, durable `calendar.create_event` outbox insertion, calendar dispatcher created/retryable/malformed-payload behavior, and Google adapter missing-credential rejection.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 10 files and 99 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API and calendar dispatcher contract integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or Google Calendar call was made.

## 2026-07-30 MP-11 Calendar Availability Recheck

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/calendar-outbox-dispatcher.test.ts`

Result: passed. Calendar dispatcher tests ran 6 tests, including provider availability recheck before create, busy-slot rejection without create, retry hint preservation from availability checks, retry hint preservation from create calls, malformed payload rejection before provider calls, and Google adapter missing-credential rejection.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 10 files and 101 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local calendar dispatcher contract tests with sanitized fixtures. No live Google Calendar call was made.

## 2026-07-30 MP-11 Calendar Delivery Reconciliation

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts -t "appointment|delivery-unknown|concurrent slot"`

Result: passed. Focused PostgreSQL tests ran 4 tests, including concurrent slot booking, durable `calendar.create_event` outbox creation, provider calendar event ID persistence back to `app.appointments` on delivered outbox commands, and preservation of `delivery_unknown` calendar creates without automatic replay.

Command: `npx vitest run tests/calendar-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: passed. Focused dispatcher/runtime tests ran 60 tests, including calendar availability recheck, busy-slot rejection without create, retry hint preservation, malformed calendar payload rejection, missing credential rejection, appointment booking idempotency, and delivery-unknown replay safety.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 10 files and 102 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/runtime and calendar dispatcher contract tests with sanitized fixtures. No live Google Calendar call was made.

## 2026-07-30 MP-11 Operator Calendar Reconciliation

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts -t "appointment|delivery-unknown|calendar create"`

Result: passed. Focused PostgreSQL tests ran 6 tests, including delivery-unknown replay safety, operator confirmation with provider event ID persistence, idempotent confirmation replay without duplicate audit, operator failure reconciliation, dead-letter capture, and failure replay without duplicate audit.

Command: `npx vitest run tests/calendar-outbox-dispatcher.test.ts tests/runtime.integration.test.ts`

Result: passed. Focused dispatcher/runtime tests ran 62 tests, including calendar availability/dispatch contract coverage plus PostgreSQL reconciliation coverage.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 10 files and 104 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/runtime, CLI build, and calendar dispatcher contract tests with sanitized fixtures. No live Google Calendar call was made.

## 2026-07-30 MP-12 Direct Ingress Route Gates

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/ingress-gating.test.ts`

Result: passed. Focused app-injection tests ran 2 tests proving direct Meta and direct lead ingress return 503 unless explicitly enabled, direct Meta challenge succeeds when enabled, and n8n compatibility remains separately reachable when `N8N_COMPAT_ROUTES_ENABLED=true`.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 11 files and 106 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local app-injection, PostgreSQL/API regression, and full npm gate. No DNS, Caddy, Meta, Facebook, Google Calendar, n8n, Typebot, or production route changes were made.

## 2026-07-30 MP-12 Cutover Readiness Report

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness"`

Result: passed. Focused PostgreSQL tests ran 2 tests covering a clean readiness report with direct/fallback flags and runtime heartbeat, plus a failing report for stale pending inbox work, stale pending outbox work, delivery-unknown commands, and unreplayed dead letters.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 11 files and 108 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL read-only readiness reporting and full npm gate. No DNS, Caddy, provider, n8n, Typebot, or production route changes were made.

## 2026-07-30 MP-12 Direct Ingress Plan

Verification: documentation-only route plan derived from implemented route flags and existing endpoint contracts. No command was required beyond the previous full gate for `8738391` and `16c0ac5`; no DNS, Caddy, provider, n8n, Typebot, or production route changes were made.

## 2026-08-01 MP-12 Deployment Verification Hardening

Command: `bash -n scripts/verify-deployment.sh`

Result: passed.

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/ingress-gating.test.ts`

Result: passed. Focused tests ran 3 tests, including a local Fastify listener exercised through `scripts/verify-deployment.sh --check-direct-meta --check-direct-lead` with direct routes expected disabled.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 11 files and 109 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local deployment-script syntax and app-listener route checks plus full npm gate. No DNS, Caddy, provider, n8n, Typebot, or production route changes were made.

## 2026-07-30 MP-09 Salesperson Command Ingestion

Command: `npm run lint`

Result: failed on first run. `SalespersonCommandProcessor` passed an optional aggregate ID as `undefined` to `AuditRepository.record` under exact optional property types. Resolution: construct `aggregateId` first and spread it only when present.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed before the lint fix because the runtime behavior was correct, but the TypeScript failure still required correction before commit. Runtime integration ran 39 PostgreSQL/API tests.

Command: `npm run lint`

Result: passed after the optional-field fix.

Command: `npx vitest run tests/runtime.integration.test.ts`

Result: passed after the optional-field fix. Runtime integration ran 39 PostgreSQL/API tests, including authenticated `/compat/n8n/salesperson/commands` durable receipt, duplicate command receipt collapsing to one processed command, active-assignee authorization, unauthorized sender rejection without assignment mutation, close-lost state mutation across `app.leads` and `edge_conversations`, and no external outbox side effect during command processing.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 76 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or salesperson-provider call was made.

## 2026-07-30 MP-09 Routing Foundation

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts tests/lead-scoring.test.ts`

Result: failed on first routing run. Duplicate reroute attempted to insert a second `app.lead_assignments` row with status `assigned`, violating `lead_assignments_lead_id_status_key`. Resolution: `LeadRoutingService` now locks and reuses existing active assignments.

Command: `npx vitest run tests/runtime.integration.test.ts tests/lead-scoring.test.ts`

Result: failed on second focused run. Recomputing after the assignment changed candidate load and selected a different salesperson. Resolution: active-assignment reuse now happens before candidate ranking, preserving assignment authority and replay idempotency.

Command: `npx vitest run tests/runtime.integration.test.ts tests/lead-scoring.test.ts`

Result: passed. Focused tests ran 38 tests, including deterministic same-client/project routing, malformed cross-client project-link rejection, stable tie-break by candidate ordering, duplicate rerun preserving one assignment and one notification command, and no-eligible routing with one operator alert command.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 9 files and 73 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL/API integration tested with sanitized fixtures. No live Meta, Typebot, n8n, Airtable, or salesperson-provider call was made.

## 2026-08-01 MP-12 Decommission Readiness Report

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts -t "decommission"`

Result: passed. Focused PostgreSQL tests ran 2 tests covering blocker reporting for legacy conversations, n8n scheduled/inbox authority, unresolved approvals, and a passing decommission report only with direct-ingress stability evidence, active versioned config, completed Edge qualification volume, stable Airtable reconciliation, final export flags, migration flags, and explicit owner approvals.

Command: `npm ci`

Result: passed. Installed 118 packages and found 0 vulnerabilities.

Command: `npm run lint`

Result: passed.

Command: `npm test`

Result: passed. Vitest ran 11 files and 111 tests.

Command: `npm run build`

Result: passed.

Command: `npm audit --audit-level=moderate`

Result: passed. Found 0 vulnerabilities.

Command: `npm run test:smoke`

Result: passed. Smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL read-only decommission reporting plus full npm gate. No DNS, Caddy, provider, n8n, Typebot, Airtable, MinIO, database, volume, or production route changes were made.

## 2026-08-01 Docker Dump Inspection Recheck

Command: `docker info`

Result: failed because the Docker client could not connect to `unix:///var/run/docker.sock`; the daemon is not available in this environment.

Command: `find /Users/yassinkhalil/Downloads/automation-20260729-220630/public -type f \( -name '*.dump' -o -name '*.sql' -o -name '*.backup' -o -name '*.tar' \) -print`

Result: located PostgreSQL dump artifacts in the read-only evidence archive, including Typebot, n8n, and conversation-edge dumps. They were not modified.

Verification level: Docker-based PostgreSQL 16 dump metadata inspection remains blocked by local daemon availability.

## 2026-08-01 MP-03 Airtable Events Import And Scoped Reconciliation

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts`

Result: passed. Focused tests ran 5 tests covering dry-run Events loading, idempotent Events import into append-only `audit.events`, secret-like payload redaction, `events_mapped` reconciliation results, missing linked lead rejection, and rollback after mid-transaction failure.

Command: `npm ci`

Result: passed. Installed 118 packages and found 0 vulnerabilities.

Command: `npm run lint`

Result: passed.

Command: `npm test`

Result: passed. Vitest ran 11 files and 111 tests.

Command: `npm run build`

Result: passed.

Command: `npm audit --audit-level=moderate`

Result: passed. Found 0 vulnerabilities.

Command: `npm run test:smoke`

Result: passed. Smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Verification level: local PostgreSQL importer/reconciliation integration plus full npm gate. No real Airtable export, external account, provider, or production data was accessed.

## 2026-08-01 Deployment Environment And Worker Readiness

Command: `npm run lint`

Result: failed on the first focused run because `tests/health-readiness.integration.test.ts` assigned the unresolved `buildApp()` promise to `app`. Resolution: await `buildApp()` in the test setup.

Command: `npx vitest run tests/env-contract.test.ts tests/health-readiness.integration.test.ts`

Result: passed after the test setup fix. Focused tests ran 2 tests covering `.env.example` alignment with validated runtime variables, generator replacement placeholders, and `/ready` failing when `RUNTIME_WORKER_ENABLED=true` lacks a runtime heartbeat, then passing after a fresh runtime heartbeat is present.

Command: `EDGE_POSTGRES_PASSWORD=dummy LEAD_CORE_ENV_FILE=/dev/null docker compose -f docker-compose.yml config`

Result: failed because this environment does not provide the `docker compose` subcommand.

Command: `EDGE_POSTGRES_PASSWORD=dummy LEAD_CORE_ENV_FILE=/dev/null docker-compose -f docker-compose.yml config`

Result: passed. Static Compose output includes `lead-core-runtime-worker` with `WORKER_KIND=runtime` and `lead-core-worker` with `WORKER_KIND=outbox`.

Command: `bash -n scripts/generate-env.sh && bash -n scripts/verify-deployment.sh && bash -n scripts/backup/backup-postgres.sh && bash -n scripts/backup/restore-postgres.sh && bash -n scripts/backup/verify-restore.sh`

Result: passed.

Command: `npm ci`

Result: passed. Installed 118 packages and found 0 vulnerabilities.

Command: `npm run lint`

Result: passed.

Command: `npm test`

Result: passed. Vitest ran 13 files and 113 tests.

Command: `npm run build`

Result: passed.

Command: `npm audit --audit-level=moderate`

Result: passed. Found 0 vulnerabilities.

Command: `npm run test:smoke`

Result: passed. Smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`, 9 questions, 22 options, and 7 messages.

Command: `npm run test:integration`

Result: passed. Integration smoke returned `ok=true`, checked 12 stop conditions, raw fallback notes, structural parity, and the same config version.

Verification level: local env-contract, static Compose config, PostgreSQL readiness integration, full npm gate, and smoke scripts. No Docker image was built because the Docker daemon remains unavailable.

## 2026-08-01 Legacy Active-Turn Compatibility Gate

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/env-contract.test.ts tests/ingress-gating.test.ts`

Result: passed. Focused tests ran 4 tests covering `.env.example` alignment with validated runtime variables, direct ingress route gates, n8n compatibility separation, deployment-script disabled route probes, and disabled `/v1/turn` returning `active_turn_compat_disabled`.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 13 files and 113 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true` with config version `4329ccc9fd4aebcb2705b1cbd5bbf1dc9ba879dd7a343c04787479d5f38f4e0d`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verification level: local env-contract, Fastify route gating, full npm gate, and smoke scripts. No live provider, DNS, Caddy, n8n, Typebot, Airtable, or production route change was made.

## 2026-08-01 Legacy Edge Outbox Bounded Retry

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts -t "outbox"`

Result: passed before final commit. Focused PostgreSQL tests ran 6 tests covering runtime outbox retry/dead-letter behavior and legacy `edge_outbox` terminal failure behavior.

Command: `npx vitest run tests/runtime.integration.test.ts -t "legacy edge outbox"`

Result: passed after the test cleanup. Focused PostgreSQL test ran 1 test proving migration-backed `dead_lettered` status, no further legacy outbox claim after terminal failure, and preserved last error/completion evidence.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed after commit `4b04128`. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 13 files and 114 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verification level: local migration-backed PostgreSQL integration, full npm gate, and smoke scripts. No live provider, n8n, Typebot, Airtable, DNS, Caddy, or production route change was made.

## 2026-08-01 Active-Turn Compatibility Readiness Evidence

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness|decommission"`

Result: passed. Focused PostgreSQL tests ran 4 tests covering cutover readiness and decommission readiness outputs, including `activeTurnCompatEnabled=false`, `active_turn_compatibility_disabled=pass`, and `active_turn_compat_disabled=pass` in the local safe state.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 13 files and 114 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verification level: local PostgreSQL readiness reporting, runbook review, full npm gate, and smoke scripts. No live provider, n8n, Typebot, Airtable, DNS, Caddy, or production route change was made.

## 2026-08-01 PostgreSQL Dump Restore-Smoke Tooling

Command: `docker info`

Result: failed because the Docker client could not connect to `unix:///var/run/docker.sock`; the daemon is not available in this environment.

Command: `DUMP_PATH=/Users/yassinkhalil/Downloads/automation-20260729-220630/public/databases/conversation-edge-postgres.dump npm run dump:inspect`

Result: failed at Docker daemon connection before inspecting the dump. The evidence archive was not modified.

Command: `DUMP_PATH=/Users/yassinkhalil/Downloads/automation-20260729-220630/public/databases/conversation-edge-postgres.dump npm run dump:restore-smoke`

Result: failed at Docker daemon connection before restore execution. The evidence archive was not modified.

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/shell-scripts.test.ts`

Result: passed. The shell parser test ran `bash -n` across generated-env, deployment verification, shadow-sequence, backup/restore, and PostgreSQL dump inspect/restore-smoke scripts.

Command: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; TypeScript lint passed; Vitest ran 14 files and 115 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verification level: local script syntax, full npm gate, and smoke scripts. Docker-backed PostgreSQL 16 dump metadata and restore-smoke execution remain blocked by daemon availability.

## 2026-08-01 Tracked Artifact Scan

Command: `npm run artifacts:scan`

Result: failed on first run because the scanner flagged the intentional tracked `.env.example`.

Resolution: `.env.example` is now explicitly allowed while `.env` and `.env.*` remain blocked.

Command: `npm run artifacts:scan`

Result: passed and printed `tracked_artifact_scan=pass`.

Command: `npm run lint`

Result: passed.

Command: `npx vitest run tests/shell-scripts.test.ts`

Result: passed. The shell parser test now includes `scripts/ops/scan-tracked-artifacts.sh`.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 14 files and 115 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verification level: tracked-file artifact hygiene, local script syntax, full npm gate, and smoke scripts.

## 2026-08-01 Final Local Handoff Gate

Command: `git show --stat --oneline 7ba47c2`

Result: passed; baseline commit history remained inspectable.

Command: `git show --stat --oneline df90f61`

Result: passed; MP-03 schema/import foundation commit history remained inspectable.

Command: `git show --stat --oneline d0e751a`

Result: passed; Airtable reconciliation commit history remained inspectable.

Command: `rg -n "TODO|FIXME|stub|mock|fake|hardcoded success|not implemented|throw new Error\\(['\\\"]Not implemented" src tests scripts docs/transition docs/owner-actions package.json`

Result: passed for production code review purposes; hits were documentation decisions about avoiding fake production implementations and a test-only `fetcher.mock` reference.

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: passed from commit `9c67bea`. `npm ci` installed 118 packages and found 0 vulnerabilities; tracked artifact scan passed; TypeScript lint passed; Vitest ran 14 files and 115 tests; build passed; audit found 0 vulnerabilities; smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

Verification level: final local repository handoff gate. Live provider, staging route, real Airtable export, Docker daemon, production cutover, and destructive decommission verification remain owner/external-action blocked.

## 2026-08-01 Final Handoff Rerun At Current Head

Command: `npm ci && npm run artifacts:scan && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke && npm run test:integration`

Result: failed only at `npm audit --audit-level=moderate` after `npm ci`, artifact scan, lint, Vitest, and build passed. The audit command reported an npm registry audit endpoint error rather than a dependency advisory.

Resolution command: `npm audit --audit-level=moderate`

Result: passed on direct retry with 0 vulnerabilities.

Resolution command: `npm run test:smoke && npm run test:integration`

Result: passed. Smoke returned `ok=true`; integration smoke returned `ok=true` with 12 stop conditions checked.

## 2026-08-01 Direct Lead Deployment Validation Probe

Command: `bash -n scripts/verify-deployment.sh`

Result: passed.

Command: `npx vitest run tests/ingress-gating.test.ts`

Result: passed. Focused app/deployment-script tests ran 4 tests, including enabled direct-lead deployment probes that send only `eventId`/`clientKey` for website and `leadgen_id`/`clientKey` for Facebook, expect `invalid_lead_payload` responses, and verify no phone/name/field-data business lead payload is sent by the verifier.

Command: `npm run lint`

Result: failed on the first run because the test parsed a possibly undefined captured request body.

Resolution: added an explicit captured-body presence check before JSON parsing.

Command: `npm run lint`

Result: passed.
