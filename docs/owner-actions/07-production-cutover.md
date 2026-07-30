# Owner Action: Production Cutover

Status: not approved for execution.

## Preflight

- Backups complete and restore verified.
- Airtable reconciliation reviewed.
- Staging journey verified.
- Provider credentials rotated.
- Templates approved and verified.
- Queue age below thresholds.
- `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-queue-age-seconds=300` reviewed with no unresolved `fail` checks.
- Rollback path rehearsed.

## Cutover Checklist

1. Freeze final legacy mutation paths where required.
2. Run final export or delta import.
3. Confirm reconciliation.
4. Drain or park queues as planned.
5. Enable rollout flag.
6. Apply explicit Caddy path route change.
7. Verify webhook challenge.
8. Send real production test message.
9. Confirm provider message ID.
10. Confirm delivery status receipt.
11. Monitor for at least the agreed window.

## Rollback Thresholds

- Any duplicate outbound customer message.
- Critical dead letter affecting customer response.
- Inbox or outbox oldest age above threshold for sustained period.
- Provider failure spike outside expected recipient errors.
- Cross-client access or routing violation.

## Rollback Sequence

1. Disable rollout flag or restore prior explicit route.
2. Do not enable automatic proxy fallback.
3. Stop new edge ownership for affected path.
4. Preserve PostgreSQL state for audit.
5. Reconcile ambiguous requests before replay.
