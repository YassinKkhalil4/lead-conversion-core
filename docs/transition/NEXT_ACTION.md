# Next Action

Last updated: 2026-07-30

Current mini-project: MP-12 Direct ingress, rollout, fallback removal, and decommission preparation

Exact next implementation task: Continue MP-12 by hardening deployment verification around the direct ingress plan. Update `scripts/verify-deployment.sh` so it can optionally verify direct Meta challenge and direct lead route disabled/enabled behavior against a supplied staging base URL without sending real customer messages, then add local script-safe checks where feasible. Do not modify DNS, Caddy, provider accounts, or legacy infrastructure.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `docs/transition/CUTOVER_RUNBOOK.md`
- `docs/transition/DIRECT_INGRESS_PLAN.md`
- `docs/transition/DECOMMISSION_RUNBOOK.md`
- `docs/owner-actions/06-staging-dns-and-access.md`
- `docs/owner-actions/07-production-cutover.md`
- `src/config/env.ts`
- `src/app.ts`
- `scripts/verify-deployment.sh`
- `tests/runtime.integration.test.ts`
- `tests/ingress-gating.test.ts`

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

Last verified implementation commit: 16c0ac5

Git worktree clean when recorded: yes
