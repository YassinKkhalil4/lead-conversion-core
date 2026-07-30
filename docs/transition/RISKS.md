# Risks

| Risk | Severity | Status | Mitigation |
|---|---:|---|---|
| Evidence archive contains credential categories and PII-bearing artifacts | Critical | open | Exclude from repo, document rotation, do not print values. |
| Current active edge sends Meta messages inside a DB transaction | Critical | open | MP-05 will route sends through durable outbox; MP-02 keeps behavior unchanged. |
| Current active edge can fall back to legacy after definite Meta rejection | High | open | MP-08 will remove automatic fallback after accepted edge ownership. |
| Current outbox retries forever and has no dead-letter state | High | open | MP-04 will add bounded attempts, leases, recovery, dead letters. |
| API and worker both run migrations at startup | High | mitigated_locally | One-shot migrator added; local concurrent migration test passed. |
| No complete Airtable export is present | High | owner_action_pending | Build importer/dry-run/reconciliation and await owner export. |
| Local `pg_restore` cannot inspect supplied dumps | Medium | workaround_available | Use PostgreSQL 16+ Docker tooling for dump metadata and restore tests. |
| No lockfile in supplied canonical source | Medium | mitigated_locally | `package-lock.json` generated; `npm ci` verified. |
| Docker daemon unavailable in local environment | Medium | open | Static Compose validation passed; image build/run and Docker-based dump inspection require daemon access. |
