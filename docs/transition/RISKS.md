# Risks

| Risk | Severity | Status | Mitigation |
|---|---:|---|---|
| Evidence archive contains credential categories and PII-bearing artifacts | Critical | open | Exclude from repo, document rotation, do not print values. |
| Legacy `/v1/turn` active route sends Meta messages inside a DB transaction | Critical | mitigated_locally | The route is disabled by default behind `ACTIVE_TURN_COMPAT_ENABLED`; new direct Meta ingress uses durable inbox/outbox. |
| Legacy `/v1/turn` active route can fall back to legacy after definite Meta rejection | High | mitigated_locally | The route is disabled by default behind `ACTIVE_TURN_COMPAT_ENABLED`; new edge-owned durable inbound processing ignores legacy-owned conversations and enqueues outbound effects transactionally. |
| Current outbox retries forever and has no dead-letter state | High | open | MP-04 will add bounded attempts, leases, recovery, dead letters. |
| API and worker both run migrations at startup | High | mitigated_locally | One-shot migrator added; local concurrent migration test passed. |
| No complete Airtable export is present | High | owner_action_pending | Build importer/dry-run/reconciliation and await owner export. |
| Local `pg_restore` cannot inspect supplied dumps | Medium | workaround_available | Use PostgreSQL 16+ Docker tooling for dump metadata and restore tests. |
| No lockfile in supplied canonical source | Medium | mitigated_locally | `package-lock.json` generated; `npm ci` verified. |
| Docker daemon unavailable in local environment | Medium | open | Static Compose validation passed; image build/run and Docker-based dump inspection require daemon access. |
