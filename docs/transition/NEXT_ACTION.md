# Next Action

Last updated: 2026-07-30

Current mini-project: MP-12 Direct ingress, rollout, fallback removal, and decommission preparation

Exact next implementation task: Begin MP-12 by auditing current ingress, compatibility routes, rollout controls, and decommission runbooks, then implement locally testable direct-ingress/canary-readiness controls without changing DNS, production Caddy routes, provider accounts, or deleting legacy infrastructure. Preserve n8n/Typebot fallback paths and add tests proving direct routes can be enabled only by explicit configuration while legacy compatibility remains available.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `docs/transition/CUTOVER_RUNBOOK.md`
- `docs/transition/DECOMMISSION_RUNBOOK.md`
- `docs/owner-actions/06-staging-dns-and-access.md`
- `docs/owner-actions/07-production-cutover.md`
- `src/config/env.ts`
- `src/routes/meta-webhooks.ts`
- `src/routes/n8n-compat.ts`
- `src/routes/lead-ingress.ts`
- `src/app.ts`
- `tests/runtime.integration.test.ts`
- `tests/*ingress*.test.ts`

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

Last verified implementation commit: fec6c33

Git worktree clean when recorded: yes
