# Next Action

Last updated: 2026-08-01

Current mini-project: MP-12 Direct ingress, rollout, fallback removal, and decommission preparation

Exact next implementation task: Run staging MP-12 verification only after the owner supplies staging route access and provider/source credentials; enable only the approved direct route plus its required runtime worker flags. Before staging, perform only targeted local hardening if a newly identified readiness/runbook defect appears; the current local audit has classified parked legacy outbox rows, rejected n8n commands, cancelled Airtable projections, missing/non-pass Airtable reconciliation evidence, accepted-row Airtable business reconciliation coverage, contact opt-out preservation, historical n8n delivery-status outcomes, direct Meta enabled/disabled deployment verification, disabled direct-ingress verifier credential independence, n8n fallback inbox worker wiring independent of direct Meta enablement, n8n compatibility runtime readiness enforcement, enabled/disabled n8n compatibility fallback deployment verification, and decommission blocking while n8n compatibility routes remain enabled.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `src/worker-runner.ts`
- `src/worker/runtime-worker-wiring.ts`
- `tests/runtime-worker-wiring.test.ts`
- `src/config/env.ts`
- `src/services/cutover-readiness-service.ts`
- `tests/env-contract.test.ts`
- `tests/ingress-gating.test.ts`
- `tests/runtime.integration.test.ts`
- `scripts/verify-deployment.sh`
- `docs/transition/DIRECT_INGRESS_PLAN.md`
- `docs/owner-actions/06-staging-dns-and-access.md`
- `docs/transition/RISKS.md`
- `src/services/decommission-readiness-service.ts`
- `scripts/cutover-readiness.ts`
- `scripts/decommission-readiness.ts`
- `tests/shell-scripts.test.ts`
- `docs/transition/DECOMMISSION_RUNBOOK.md`
- `docs/owner-actions/07-production-cutover.md`
- `scripts/import-airtable.ts`
- `scripts/reconcile-airtable.ts`
- `tests/fixtures/airtable-export/Leads.json`
- `tests/import-airtable.test.ts`
- `tests/import-airtable.integration.test.ts`
- `docs/transition/DATA_MIGRATION.md`
- `docs/transition/DATA_RECONCILIATION.md`

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
- `npm run artifacts:scan`
- Focused PostgreSQL/API tests for any changed readiness or inbox path
- `scripts/verify-deployment.sh --base-url=<staging-url> --check-direct-meta --check-direct-lead --check-n8n-compat --expect-direct-meta=<enabled|disabled> --expect-direct-lead=<enabled|disabled> --expect-n8n-compat=<enabled|disabled>` when staging owner inputs are available
- `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-pending-scheduled-jobs=0 --max-queue-age-seconds=300`
- `npm run decommission:readiness` with only evidence-backed owner flags

Known blockers:

- Complete real Airtable export is unavailable for production reconciliation.
- Docker daemon is unavailable for image run and Docker-based dump metadata inspection.
- Rotated Meta credentials, approved templates, and staging webhook access are unavailable for live WhatsApp verification.
- Real website/Facebook lead source configuration is unavailable for live lead intake verification.
- Google Calendar credentials and calendar IDs are unavailable for live calendar verification.
- Owner approval is unavailable for production cutover and for destructive n8n, Typebot, Airtable, MinIO, database, volume, or route removal.

Last verified commit: `66d3c46` (`Require complete Airtable reconciliation for decommission`), with focused decommission PostgreSQL tests, `npm ci`, tracked artifact scan, TypeScript lint, full Vitest suite, production build, `dist/tests` exclusion check, moderate audit, smoke test, and integration smoke all passing.

Git worktree clean when recorded: yes
