# Next Action

Last updated: 2026-07-30

Current mini-project: MP-06 Versioned configuration

Exact next implementation task: Begin MP-06 by adding immutable published configuration tables/migrations and a validation/diff/publish CLI that can import the current seed configuration without mutating executable code.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/00*_*.sql`
- `src/configuration/**`
- `src/services/**`
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

Last verified implementation commit: e133c40 plus uncommitted MP-05 n8n compatibility slice verified by the full npm/lint/test/build/audit/smoke gate

Git worktree clean when recorded: no
