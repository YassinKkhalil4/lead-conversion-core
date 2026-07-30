# Cutover Runbook

Status: draft, not approved for production execution.

1. Confirm latest backups and restore verification.
2. Confirm Airtable reconciliation reviewed and accepted.
3. Confirm queues drained or within accepted thresholds.
4. Confirm provider credentials rotated and configured.
5. Confirm staging journey evidence is complete.
6. Apply rollout flag or Caddy path route change.
7. Verify webhook challenge/signature.
8. Send a real test message.
9. Confirm provider message ID and delivery status.
10. Monitor inbox/outbox age, dead letters, delivery unknown, provider errors, and DB pool saturation.
11. Roll back if thresholds in `docs/owner-actions/07-production-cutover.md` are met.
