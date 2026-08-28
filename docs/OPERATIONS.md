# Operations Runbook

Initial operator surfaces:

- `/health` for process liveness
- `/ready` for database, migration, and enabled-worker heartbeat readiness
- `/metrics` for Prometheus metrics
- `scripts/ops/*` for local operational checks
- `npm run artifacts:scan` before commit/release to verify ignored runtime archives and credential-like files are not tracked
- `DUMP_PATH=/path/to/archive.dump npm run dump:inspect` and `DUMP_PATH=/path/to/archive.dump npm run dump:restore-smoke` for PostgreSQL 16 dump inspection when Docker is available
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
