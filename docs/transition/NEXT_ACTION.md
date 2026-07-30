# Next Action

Last updated: 2026-07-30

Current mini-project: MP-11 Appointments and Google Calendar

Exact next implementation task: Begin MP-11 by adding the internal appointment scheduling foundation. Persist appointment offers and slots with deterministic semantic identities, enforce slot locks and duplicate reply idempotency in PostgreSQL, add a disabled Google Calendar adapter shape that never fakes success, enqueue calendar-create outbox commands only after durable appointment state changes, and add PostgreSQL integration tests for concurrent slot booking, duplicate replies, cancellation/supersession, provider failure classification, and no external HTTP inside transactions.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/020_appointment_scheduling.sql`
- `src/services/appointment-service.ts`
- `src/integrations/calendar/**`
- `src/worker-runner.ts`
- `src/worker/messaging-outbox-dispatcher.ts`
- `src/worker/calendar-outbox-dispatcher.ts`
- `tests/runtime.integration.test.ts`
- `tests/calendar-*.test.ts`

Required verification:

- `git status --short`
- `git log --oneline --decorate -10`
- `git show --stat 7ba47c2`
- `git show --stat df90f61`
- `git show --stat d0e751a`
- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=moderate`
- `npm run test:smoke`
- Disposable PostgreSQL migration/import/reconciliation/runtime checks

Known blockers:

- Complete real Airtable export is unavailable for production reconciliation.
- Docker daemon is unavailable for image run and Docker-based dump metadata inspection.
- Rotated Meta credentials, approved templates, and staging webhook access are unavailable for live WhatsApp verification.
- Real website/Facebook lead source configuration is unavailable for live lead intake verification.
- Google Calendar credentials and calendar IDs are unavailable for live calendar verification.

Last verified implementation commit: 18a33a6

Git worktree clean when recorded: yes
