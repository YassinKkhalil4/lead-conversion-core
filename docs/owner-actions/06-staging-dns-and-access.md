# Owner Action: Staging DNS And Access

Status: pending owner infrastructure setup.

## Required Staging Resources

- Separate staging database
- Separate staging secrets
- Staging callback URL
- Test phone numbers
- Test Calendar
- Network access for Meta callbacks
- Caddy route for staging edge ingress
- Explicit staging flags for direct ingress: `DIRECT_META_WEBHOOK_ENABLED=true`, `RUNTIME_WORKER_ENABLED=true`, and `META_STATUS_PROCESSOR_ENABLED=true` only for Meta callback tests; `DIRECT_LEAD_INGRESS_ENABLED=true` and `RUNTIME_WORKER_ENABLED=true` only for direct website/Facebook callback tests
- If n8n compatibility fallback routes remain enabled in staging, `N8N_COMPAT_ROUTES_ENABLED=true` must be paired with `RUNTIME_WORKER_ENABLED=true`
- Encrypted backup target
- Named operators authorized to run live commands

## Verification

1. `/health` and `/ready` return healthy.
2. Webhook challenge succeeds.
3. Signed test webhook is accepted.
4. Unsigned invalid webhook is rejected.
5. Test backup completes.
6. Restore verification succeeds.
7. `scripts/verify-deployment.sh --base-url=<staging-url> --check-direct-meta --check-direct-lead --check-n8n-compat --expect-direct-meta=<enabled|disabled> --expect-direct-lead=<enabled|disabled> --expect-n8n-compat=<enabled|disabled>` passes for the approved staging route state. The direct-Meta check verifies challenge and POST behavior for the expected route state: when enabled, a signed non-customer webhook probe should be durably receipted through the ignored-webhook path and an unsigned POST must be rejected; when disabled, both challenge and POST must be unavailable without requiring Meta credentials. The enabled direct-lead checks are deliberately incomplete website and Facebook durable-receipt probes; review any resulting ignored inbox events as verification evidence, not as business leads. Disabled direct-lead checks prove route unavailability without requiring `EDGE_SHARED_SECRET` when shadow verification is skipped. The n8n compatibility check requires `EDGE_INTERNAL_SECRET`; when enabled, it posts a non-customer fallback inbound probe and expects durable receipt acknowledgement, and when disabled it proves the authenticated route is unavailable.
8. After the approved direct-ingress flag and required runtime worker flags are enabled in staging, `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-pending-scheduled-jobs=0 --max-queue-age-seconds=300` is reviewed before external staging route changes. The report must include `direct_ingress_target_selected=pass`; n8n fallback availability alone is not enough.
9. `npm run decommission:readiness -- --direct-stability-days=14 --min-completed-edge-qualifications=100 --max-worker-heartbeat-age-seconds=120` is reviewed only after staging has generated enough direct-ingress and Edge qualification evidence; do not pass owner approval flags unless the corresponding owner evidence is complete.
