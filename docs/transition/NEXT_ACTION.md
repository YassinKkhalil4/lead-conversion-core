# Next Action

Last updated: 2026-07-30

Current mini-project: MP-10 Follow-ups, SLA, reporting

Exact next implementation task: Continue MP-10 by adding durable daily reporting. Persist semantic report jobs with explicit client timezone, generate SQL-backed daily summaries for lead intake, qualification, assignment acknowledgement, SLA breaches, follow-ups, message delivery, and dead letters, enqueue report outbox commands without provider calls inside transactions, and add PostgreSQL integration tests for duplicate schedules, cancelled/superseded reports, expired leases, report row-count accuracy, and outbox idempotency.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/019_reporting_jobs.sql`
- `src/services/reporting-service.ts`
- `src/worker-runner.ts`
- `src/worker/messaging-outbox-dispatcher.ts`
- `tests/runtime.integration.test.ts`
- `tests/messaging-outbox-dispatcher.test.ts`

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

Last verified implementation commit: 0b8dd82

Git worktree clean when recorded: yes
