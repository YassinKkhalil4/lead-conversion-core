# Decisions

## DEC-001: Clean Repository Location

Decision: Use `/Users/yassinkhalil/Developer/lead-conversion-core` as the clean canonical implementation repository.

Reason: The supplied evidence folder is not a Git repository and contains secret-bearing/runtime artifacts that must remain read-only.

Date: 2026-07-30

## DEC-002: Initial Canonical Source

Decision: Start from `source/conversation-edge` after verifying the duplicate tree `source/lead-conversion-os-active-test-v2/conversation-edge` is byte-identical by `diff -rq`.

Reason: It is the smallest canonical edge implementation and avoids copying broader evidence, deployment history, and runtime artifacts.

Date: 2026-07-30

## DEC-003: Runtime Stack

Decision: Keep Node.js 22+, TypeScript, Fastify, `pg`, Zod, Pino, `prom-client`, Vitest, and PostgreSQL 16.

Reason: This matches the supplied implementation and the migration brief; no evidenced need exists for an ORM or external orchestrator.

Date: 2026-07-30

## DEC-004: One-Shot Migrator

Decision: API and worker containers no longer run migrations at startup. `lead-core-migrate` is the one-shot migration container, and `scripts/migrate.ts` uses a PostgreSQL advisory lock plus SHA-256 migration checksums.

Reason: Startup migrations from multiple long-running services can race and cannot detect modified applied SQL.

Date: 2026-07-30

## DEC-005: Vitest Upgrade

Decision: Upgrade Vitest to the latest resolved major version in the lockfile.

Reason: The initial lockfile generation exposed critical/high audit findings in the older Vitest/Vite dev-tool chain. The upgrade produced zero `npm audit` findings and tests remained green.

Date: 2026-07-30

## DEC-006: Codex Repository Instructions

Decision: Replace Claude-specific repository instruction files with root `AGENTS.md`.

Reason: The repository is now operated with Codex. Durable instructions must be discoverable by Codex without relying on Claude Code conventions.

Date: 2026-07-30

## DEC-007: Importer Requires Stable Source IDs

Decision: Reject Airtable rows that do not include a stable record ID instead of synthesizing one from content and row position.

Reason: Synthetic IDs are not stable across exports and would corrupt idempotency/entity mapping guarantees.

Date: 2026-07-30

## DEC-008: Readiness Requires Migration Completeness

Decision: `/ready` compares applied migration rows against migration files on disk and fails if any migration is missing.

Reason: A database connection plus latest-row display does not prove the required schema is present.

Date: 2026-07-30

## DEC-009: Runtime Worker Handler Boundary

Decision: Introduce the durable runtime worker with injectable inbox, outbox, and scheduled-job handlers, and keep it disabled unless real handlers are configured.

Reason: MP-04 owns durable queue semantics, leases, retries, and audit history. Provider-specific dispatch and business processors belong to later MPs; the worker must not fake successful production side effects while those adapters are disabled.

Date: 2026-07-30

## DEC-010: Meta Adapter Disabled By Default

Decision: Add the Meta WhatsApp adapter behind an explicit enabled configuration and classify provider outcomes from real response shapes instead of returning hardcoded success.

Reason: Live Meta credentials and template approvals are pending owner action. The code can be contract-tested with sanitized fixtures, but production must not send or pretend to send messages until credentials, templates, and staging webhooks are verified.

Date: 2026-07-30

## DEC-011: Conversation Configuration Pins

Decision: Store `configuration_version_id` on legacy `edge_conversations` in addition to the existing `config_version` text key, and only re-pin an existing conversation through the explicit bootstrap `migrateConfig` path.

Reason: Conversations must remain pinned to the configuration they started with during cutover, while operators still need a deliberate compatibility path to move a legacy conversation onto a newer immutable published configuration.

Date: 2026-07-30

## DEC-012: Airtable Configuration Export Validation

Decision: Compile Airtable configuration exports only from the verified Questions, Question Options, and Conversation Messages field names, require stable Airtable record IDs, normalize CSV booleans and linked-record fields, and reject malformed rows before publishing.

Reason: The real Airtable export is unavailable. Local parity can be proven against sanitized Airtable-shaped exports, but production configuration authority must not be published from rows with missing IDs, duplicate IDs, invalid active flags, missing links, or missing display text.

Date: 2026-07-30
