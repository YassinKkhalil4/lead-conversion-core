# Next Action

Last updated: 2026-07-30

Current mini-project: MP-09 Scoring, routing, commands, and alerts

Exact next implementation task: Begin MP-09 by adding deterministic `real_estate_v1` lead scoring from completed qualification answers and lead/app state, persisting score runs in PostgreSQL, updating lead temperature/score atomically, recording audit events, and adding unit/PostgreSQL integration tests for score factors, idempotent reruns, and missing-answer behavior.

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

Last verified implementation commit: f346dfd

Git worktree clean when recorded: yes
