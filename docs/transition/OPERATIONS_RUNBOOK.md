# Operations Runbook

Initial operator surfaces:

- `/health` for process liveness
- `/ready` for database, migration, and enabled-worker heartbeat readiness
- `/metrics` for Prometheus metrics
- `scripts/ops/*` for local operational checks
- SQL views and migration/reconciliation reports as they are added

Alert categories:

- Oldest inbox/outbox over 60 seconds
- Critical customer message dead-lettered
- Worker heartbeat missing over 2 minutes
- Provider error spike
- Database storage over 75%
- Backup missed
- Restore verification failure
- Airtable projection drift during transition
