# Next Action

Last updated: 2026-08-09

Current mini-project: MP-12 Direct ingress, rollout, fallback removal, and decommission preparation

Exact next implementation task: Run staging MP-12 verification only after the owner supplies staging route access and provider/source credentials; enable only the approved direct route plus its required runtime worker flags. Before staging, perform only targeted local hardening if a newly identified readiness/runbook defect appears; the current local audit has classified parked legacy outbox rows, terminal runtime outbox failures, rejected n8n commands, cancelled Airtable projections, missing/non-pass Airtable reconciliation evidence, accepted-row Airtable business reconciliation coverage, contact opt-out preservation, historical n8n delivery-status outcomes, direct Meta enabled/disabled deployment verification, disabled direct-ingress verifier credential independence, n8n fallback inbox worker wiring independent of direct Meta enablement, n8n compatibility runtime readiness enforcement, cutover readiness failure when no direct-ingress target is selected, enabled/disabled n8n compatibility fallback deployment verification, deployment and shadow verifier probe identities being run-scoped to avoid durable-inbox collisions, deployment/shadow env-file loading using parsed assignments instead of shell `source`, duplicate deployment/shadow env keys failing closed before ambiguous overrides can change route flags or secrets, parsed env assignment temp files being explicitly chmodded private before secret-bearing values are written, parsed env values rejecting decoded NUL/newline characters before the NUL-delimited export stream is built, backup outputs being locked and refused when timestamped encrypted dump or checksum paths already exist, encrypted backup dumps requiring checksum verification before restore by default, calendar reconciliation operator arguments failing closed before PostgreSQL access, configuration publish/rollback operator arguments failing closed before service construction, Airtable import/reconciliation operator arguments failing closed before source-file load or PostgreSQL access, decommission blocking while n8n compatibility routes remain enabled, direct-ingress decommission stability measured from processing completion time, recent legacy-owned conversation activity blocking n8n/Typebot decommission, active legacy-only config snapshots blocking Typebot decommission, imported or detached qualification rows being excluded from Typebot decommission volume, n8n scheduled authority detection across durable job semantic identity fields, direct lead decommission stability requiring both website and Facebook lead evidence, Typebot removal requiring a published active configuration version, cutover/decommission readiness threshold arguments failing closed to non-negative integers, readiness threshold parsing accepting only canonical base-10 integer strings, unsafe readiness thresholds being rejected before JavaScript numeric precision loss, and invalid worker role names failing environment validation before the wrong worker loop can start.

Files expected to change:

- None for staging verification until owner-supplied route access and credentials are available.
- If targeted local hardening finds a defect before staging, change only the affected source/script/test files plus `docs/transition/STATUS.md`, `docs/transition/WORK_QUEUE.md`, `docs/transition/NEXT_ACTION.md`, `docs/transition/IMPLEMENTATION_LEDGER.md`, `docs/transition/TEST_EVIDENCE.md`, and `docs/transition/DECISIONS.md` when an architectural or operational decision changes.

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

Last verified commit: `70a5f29` (`Harden Airtable migration CLI arguments`), with focused Airtable parser/import integration tests, shell/config parser regression tests, `npm ci`, tracked artifact scan, TypeScript lint, full Vitest suite, production build, `dist/tests` exclusion check, moderate audit, smoke test, integration smoke, and `git diff --check` all passing. Docker-backed dump metadata inspection and restore smoke remain blocked by unavailable local Docker daemon.

Git worktree clean when recorded: yes
