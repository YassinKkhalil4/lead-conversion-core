# Cutover Runbook

Status: draft, not approved for production execution.

1. Confirm latest backups and restore verification.
2. Confirm Airtable reconciliation reviewed and accepted.
3. Confirm queues drained or within accepted thresholds.
4. Confirm provider credentials rotated and configured.
5. Confirm staging journey evidence is complete.
6. Run `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-pending-scheduled-jobs=0 --max-queue-age-seconds=300` and review all `fail` checks before changing routes.
7. Enable the relevant direct-ingress flag in staging or production configuration only after owner approval: `DIRECT_META_WEBHOOK_ENABLED=true` with `RUNTIME_WORKER_ENABLED=true` and `META_STATUS_PROCESSOR_ENABLED=true` for Meta callbacks, or `DIRECT_LEAD_INGRESS_ENABLED=true` with `RUNTIME_WORKER_ENABLED=true` for direct website/Facebook lead callbacks.
8. Keep `ACTIVE_TURN_COMPAT_ENABLED=false` during direct-ingress cutover unless the owner deliberately authorizes the legacy synchronous compatibility path for rollback testing.
9. Apply rollout flag or Caddy path route change.
10. Verify webhook challenge/signature. For direct website/Facebook lead ingress, use the deployment verifier's incomplete durable-receipt probes first; they should be durably acknowledged without creating an authoritative lead or outbound command inside the webhook request.
11. Send a real test message.
12. Confirm provider message ID and delivery status.
13. Monitor inbox/outbox age, dead letters, delivery unknown, provider errors, and DB pool saturation.
14. Roll back if thresholds in `docs/owner-actions/07-production-cutover.md` are met.

Legacy fallback removal is a separate owner-approved step after cutover stability. Before any removal, run `npm run decommission:readiness` and review every n8n, Typebot, and Airtable check.
