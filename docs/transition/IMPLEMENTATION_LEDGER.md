# Implementation Ledger

## 2026-07-30

- Commit `7ba47c2`: Established clean repository from reviewed `source/conversation-edge`; added transition docs, owner-action docs, strict ignore rules, lockfile, migrator checksums/advisory lock, runtime heartbeat foundation, backup/restore scripts, and source tests.
- Commit `df90f61`: Added app/runtime/configuration/audit/migration schemas and initial Airtable import foundation for raw records, rejects, clients, projects, salespeople, contacts, and leads.
- Commit `d0e751a`: Added Airtable reconciliation checks and recording.
- Verification failure: first parallel audit command ran `npm ci`, lint, test, and build concurrently. Lint/test/build failed transiently because `node_modules` was being replaced. Resolution: reran gates serially after `npm ci`, and serial gates passed.
- Deferred external verification: Docker daemon unavailable for image run and Docker-based dump metadata inspection.
- Deferred external verification: real Airtable export unavailable for production reconciliation.
- Deferred external verification: Meta, Google Calendar, and Facebook credentials unavailable for live provider validation.
- Implementation slice: Converted repository instructions from Claude-specific `CLAUDE.md` and `.claude/rules/` into Codex `AGENTS.md`; added `WORK_QUEUE.md`, `NEXT_ACTION.md`, and `IMPLEMENTATION_LEDGER.md`.
- Decision: Missing Airtable record IDs are rejected instead of synthesized to preserve idempotent source identity.
- Decision: `/ready` must prove all migration files have applied, not merely that PostgreSQL is reachable.
- Verification failure: parallel `npm ci` with lint/test/build caused transient missing modules/types while `node_modules` was replaced. Resolution: reran serially; serial gate passed.
- Verification failure: importer rollback test initially reused `recPROJECT001`, causing a false positive raw-record count. Resolution: changed failing fixture to unique `recPROJECTSQLBAD`; test passed.
- Implementation slice: Hardened importer manifest/rejection behavior, added provisional Airtable field map, improved restore verification, and added PostgreSQL-backed importer tests for idempotency, missing relationships, and rollback.
