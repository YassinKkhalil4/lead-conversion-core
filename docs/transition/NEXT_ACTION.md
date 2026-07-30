# Next Action

Last updated: 2026-07-30

Current mini-project: MP-11 Appointments and Google Calendar

Exact next implementation task: Continue MP-11 by adding operator-visible calendar reconciliation for ambiguous `calendar.create_event` outcomes. The next slice should expose a safe local reconciliation command/service for `runtime.outbox_commands.state='delivery_unknown'` calendar creates, allow an operator to attach a verified provider event ID or mark the create permanently failed, update the linked appointment/audit records transactionally, and add PostgreSQL tests proving reconciliation is idempotent and does not call Google automatically.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `src/services/appointment-service.ts`
- `src/integrations/calendar/**`
- `src/infrastructure/runtime.ts`
- `src/worker-runner.ts`
- `src/worker/calendar-outbox-dispatcher.ts`
- `src/worker/calendar-reconciliation.ts`
- `scripts/calendar-reconcile.ts`
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

Last verified implementation commit: 284b110

Git worktree clean when recorded: yes
