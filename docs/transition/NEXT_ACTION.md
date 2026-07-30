# Next Action

Last updated: 2026-07-30

Current mini-project: MP-10 Follow-ups, SLA, reporting

Exact next implementation task: Begin MP-10 by adding durable follow-up scheduling. Persist semantic follow-up jobs in `runtime.scheduled_jobs` from lead/conversation state, prevent duplicate follow-up jobs per lead/stage, store timezone explicitly, cancel or supersede jobs on opt-out, human takeover, assignment, close-lost, or qualification completion, and add PostgreSQL integration tests for duplicate prevention, cancellation, lease recovery, and no in-process scheduling authority.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/00*_*.sql`
- `src/domain/**`
- `src/services/**`
- `src/routes/**`
- `scripts/**`
- `tests/**/*`

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

Last verified implementation commit: 229e01c

Git worktree clean when recorded: yes
