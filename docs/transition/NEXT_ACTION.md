# Next Action

Last updated: 2026-08-01

Current mini-project: MP-12 Direct ingress, rollout, fallback removal, and decommission preparation

Exact next implementation task: Run staging MP-12 verification once the owner supplies staging route access and provider/source credentials. Enable only the approved direct route plus its required runtime worker flags, use `scripts/verify-deployment.sh` with explicit direct-ingress expectations, confirm `npm run cutover:readiness` shows direct-inbox processor metadata for any enabled direct route, and run `npm run decommission:readiness` only as a read-only report. Do not remove n8n, Typebot, Airtable, MinIO, databases, volumes, or production routes without explicit owner approval.

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
- `scripts/verify-deployment.sh --base-url=<staging-url> --check-direct-meta --check-direct-lead --expect-direct-meta=<enabled|disabled> --expect-direct-lead=<enabled|disabled>`
- `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-pending-scheduled-jobs=0 --max-queue-age-seconds=300`
- `npm run decommission:readiness` with only evidence-backed owner flags

Known blockers:

- Complete real Airtable export is unavailable for production reconciliation.
- Docker daemon is unavailable for image run and Docker-based dump metadata inspection.
- Rotated Meta credentials, approved templates, and staging webhook access are unavailable for live WhatsApp verification.
- Real website/Facebook lead source configuration is unavailable for live lead intake verification.
- Google Calendar credentials and calendar IDs are unavailable for live calendar verification.
- Owner approval is unavailable for production cutover and for destructive n8n, Typebot, Airtable, MinIO, database, volume, or route removal.

Last verified commit: `a0c61a5` (`Require runtime worker for direct ingress flags`), with the full local gate passing before commit and only persistent state docs changed afterward.

Git worktree clean when recorded: yes
