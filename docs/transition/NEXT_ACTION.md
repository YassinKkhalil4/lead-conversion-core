# Next Action

Last updated: 2026-07-30

Current mini-project: MP-03 PostgreSQL core and Airtable migration foundation

Exact next implementation task: Finish MP-03 documentation/commit for expanded historical adapters, then begin MP-04 durable inbox/outbox/jobs/audit runtime.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/00*_*.sql`
- `src/infrastructure/**`
- `src/repositories/**`
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
- Disposable PostgreSQL migration/import/reconciliation checks

Known blockers:

- Complete real Airtable export is unavailable for production reconciliation.
- Docker daemon is unavailable for image run and Docker-based dump metadata inspection.
- Rotated provider credentials are unavailable for live integrations.

Last verified commit: 52721ad plus uncommitted MP-03 expanded adapters verified by local gates

Git worktree clean when recorded: yes
