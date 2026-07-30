# Next Action

Last updated: 2026-07-30

Current mini-project: MP-05 WhatsApp messaging platform

Exact next implementation task: Continue MP-05 by adding Meta WhatsApp status webhook ingestion through the durable inbox path, including signature/raw-body handling, provider status mapping, message delivery event persistence, and idempotent duplicate handling.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `src/integrations/**`
- `src/worker/**`
- `src/services/**`
- `src/routes/**`
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

Last verified implementation commit: 58c6e33

Git worktree clean when recorded: yes
