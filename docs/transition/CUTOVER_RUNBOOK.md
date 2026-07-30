# Cutover Runbook

Status: draft, not approved for production execution.

1. Confirm latest backups and restore verification.
2. Confirm Airtable reconciliation reviewed and accepted.
3. Confirm queues drained or within accepted thresholds.
4. Confirm provider credentials rotated and configured.
5. Confirm staging journey evidence is complete.
6. Run `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-queue-age-seconds=300` and review all `fail` checks before changing routes.
7. Enable the relevant direct-ingress flag in staging or production configuration only after owner approval: `DIRECT_META_WEBHOOK_ENABLED=true` for Meta callbacks and `DIRECT_LEAD_INGRESS_ENABLED=true` for direct website/Facebook lead callbacks.
8. Apply rollout flag or Caddy path route change.
9. Verify webhook challenge/signature.
10. Send a real test message.
11. Confirm provider message ID and delivery status.
12. Monitor inbox/outbox age, dead letters, delivery unknown, provider errors, and DB pool saturation.
13. Roll back if thresholds in `docs/owner-actions/07-production-cutover.md` are met.
