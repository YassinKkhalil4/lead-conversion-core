# Cutover Runbook

Status: draft, not approved for production execution.

1. Confirm latest backups and restore verification.
2. Confirm Airtable reconciliation reviewed and accepted.
3. Confirm queues drained or within accepted thresholds.
4. Confirm provider credentials rotated and configured.
5. Confirm staging journey evidence is complete.
6. Enable the relevant direct-ingress flag in staging or production configuration only after owner approval: `DIRECT_META_WEBHOOK_ENABLED=true` for Meta callbacks and `DIRECT_LEAD_INGRESS_ENABLED=true` for direct website/Facebook lead callbacks.
7. Apply rollout flag or Caddy path route change.
8. Verify webhook challenge/signature.
9. Send a real test message.
10. Confirm provider message ID and delivery status.
11. Monitor inbox/outbox age, dead letters, delivery unknown, provider errors, and DB pool saturation.
12. Roll back if thresholds in `docs/owner-actions/07-production-cutover.md` are met.
