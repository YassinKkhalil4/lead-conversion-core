# AGENTS.md

## Repository Purpose

This repository is the clean canonical implementation for the WhatsApp-first real-estate lead-conversion migration. The target is a single TypeScript modular monolith where Edge owns business logic, PostgreSQL owns durable business state, public events enter through a durable inbox, and every external side effect leaves through a durable outbox.

The evidence archive at `/Users/yassinkhalil/Downloads/automation-20260729-220630/public` is read-only. Never modify it.

## Target Architecture

- Runtime stack: Node.js 22+, TypeScript, Fastify, `pg`, Zod, Pino, `prom-client`, Vitest, PostgreSQL 16.
- Module boundaries: clients, contacts, leads, intake, messaging, conversations, qualification, scoring, routing, followups, appointments, reporting, configuration, plus infrastructure for db/inbox/outbox/jobs/audit/providers.
- Do not create microservices. Do not add Kafka, RabbitMQ, Redis, Temporal, an ORM, or another orchestration platform without documented evidence and explicit owner approval.
- Airtable is migration input and temporary one-way visibility projection only.
- n8n and Typebot are compatibility/fallback runtimes during cutover only.

## Source Of Truth

- PostgreSQL is authoritative for migrated capabilities.
- Legacy Airtable IDs are migration/audit identifiers, not business authorities.
- Configuration must be validated, versioned, immutable once published, diffable, auditable, and pinned to conversations.
- Keep rollback/compatibility paths until documented exit criteria and owner approval.

## Build And Test Commands

Run the narrowest relevant command after each change, then the broader gate before committing:

- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=moderate`
- `npm run test:smoke`

Use disposable local PostgreSQL instances for DB integration tests. Never use a production or unknown database.

## Migration Rules

- Schema changes require additive migrations. Do not edit already-applied migrations.
- Migrations run only through the migrator, not normal API or worker startup.
- Applied migrations require an advisory lock and checksum verification.
- Store timestamps in UTC. Convert display/schedule behavior using explicit client timezones, initially `Africa/Cairo`.
- Every mutation must have a transactional guarantee or verified postcondition.

## Inbox, Outbox, Jobs, Audit

- Public webhook receipt must be durably committed before acknowledgement.
- Inbox processing is separate from receipt and uses leases, idempotency, retry bounds, dead letters, and replay history.
- Insert outbox commands in the same PostgreSQL transaction as the business-state change requesting the external effect.
- Do not perform external HTTP calls inside database transactions.
- Workers own retries, leases, schedules, dead-lettering, reconciliation, and reporting.
- Scheduled jobs must be durable PostgreSQL rows, not in-process timers.
- Audit records are append-only and must avoid secrets and unnecessary PII.

## Idempotency

- Use provider-stable IDs when present. If absent, use documented deterministic payload hashes.
- Do not use random, timestamp-only, or `Date.now()` identifiers as business idempotency keys.
- Queue claims require deterministic ordering and `FOR UPDATE SKIP LOCKED`.
- Do not claim exactly-once delivery. Implement at-least-once delivery with idempotent processing and explicit ambiguous-delivery handling.

## External Integrations

- Missing Airtable export, Meta credentials, Google Calendar credentials, Facebook credentials, DNS access, production infrastructure, or Docker daemon availability is not a global blocker.
- When blocked externally: implement internal code/tests, real adapter shape, sanitized contract fixtures, disabled production configuration, exact owner-action docs, and pending live-verification status. Then continue other unblocked work.
- Production code must never return hardcoded success or silently simulate an external provider.

## Secrets

- Never print, copy, document, or commit credential values.
- Do not commit `.env*` except `.env.example`, dumps, PII exports, Docker inspect output, resolved secret-bearing Compose, encrypted credential exports, MinIO archives, `dist`, or `node_modules`.
- Public inputs must authenticate or fail closed.
- Verify raw-body HMAC signatures for provider webhooks.
- Redact or hash PII in general logs and metrics.

## Documentation Ledger

Update persistent state as part of each coherent slice:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `docs/transition/DECISIONS.md` for important decisions
- Owner-action docs under `docs/owner-actions/` for external steps

## Git

- Work only in `/Users/yassinkhalil/Developer/lead-conversion-core`.
- Current migration branch: `transition/edge-postgres-core`.
- Create local commits for coherent verified slices.
- Do not push, open PRs, rewrite history, deploy, rotate credentials, mutate production, or delete legacy systems/data.
- Do not leave half-written migrations or partially staged commits.

## Genuine Blockers

A blocker is limited to a required destructive action, production mutation, external-account change, credential rotation, real deployment, missing business decision that changes persisted behavior, missing external artifact required to validate one specific integration, filesystem permission failure inside the repo, or unavoidable Codex execution limit.

A blocker in one workstream does not stop unrelated unblocked implementation.
