# Next Action

Last updated: 2026-07-30

Current mini-project: MP-11 Appointments and Google Calendar

Exact next implementation task: Continue MP-11 by adding calendar reconciliation after dispatch. Persist provider calendar event IDs back to `app.appointments`, preserve delivery-unknown outcomes without blindly creating another event, add an operator-visible reconciliation command for ambiguous calendar creates, and add PostgreSQL/dispatcher tests for provider event ID persistence, delivery-unknown state, replay safety, and reconciliation without external mutations.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/021_calendar_reconciliation.sql`
- `src/services/appointment-service.ts`
- `src/integrations/calendar/**`
- `src/infrastructure/runtime.ts`
- `src/worker-runner.ts`
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

Last verified implementation commit: 4425613

Git worktree clean when recorded: yes
