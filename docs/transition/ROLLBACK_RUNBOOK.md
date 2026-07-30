# Rollback Runbook

Status: draft, not approved for production execution.

- Do not use automatic reverse-proxy fallback.
- Roll back by restoring the prior explicit route or rollout flag.
- Keep accepted edge events in PostgreSQL for audit and reconciliation.
- Do not process an ambiguous request in both systems.
- Do not delete new tables during rollback.
- Preserve all dead letters and delivery-unknown records for investigation.
