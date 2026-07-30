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
