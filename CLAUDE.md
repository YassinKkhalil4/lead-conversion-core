# Lead Conversion Core

This repository is the clean canonical implementation for the WhatsApp-first real-estate lead conversion migration. The evidence archive at `/Users/yassinkhalil/Downloads/automation-20260729-220630/public` is read-only and must not be modified.

## Current State

- Branch: `transition/edge-postgres-core`
- Source baseline: reviewed copy of `source/conversation-edge`
- Runtime target: modular monolith with Node.js 22+, TypeScript, Fastify, `pg`, Zod, Pino, `prom-client`, Vitest, PostgreSQL 16
- Authority target: PostgreSQL durable business state, durable inbox before acknowledgement, durable outbox for external side effects

## Rules

- Never commit secrets, dumps, PII exports, Docker inspect output, resolved secret-bearing Compose files, MinIO archives, `dist`, or `node_modules`.
- Do not call external providers inside database transactions.
- Do not acknowledge public webhooks before raw receipt and normalized events are durably committed.
- Do not claim exactly-once delivery; implement at-least-once delivery with idempotent processing.
- Keep n8n, Typebot, and Airtable as transition dependencies only until documented exit criteria are met and owner approval is explicit.
- Store timestamps in UTC and convert using explicit client timezones. Default initial timezone is `Africa/Cairo`.
- Record every material decision, risk, test command, and result in `docs/transition/`.

## Persistent Docs

- Architecture rules: `.claude/rules/architecture.md`
- Database rules: `.claude/rules/database.md`
- Testing rules: `.claude/rules/testing.md`
- Security rules: `.claude/rules/security.md`
- Migration rules: `.claude/rules/migration.md`
- Master plan and status: `docs/transition/MASTER_PLAN.md`, `docs/transition/STATUS.md`
