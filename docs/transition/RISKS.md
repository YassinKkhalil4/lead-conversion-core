# Risks

| Risk | Severity | Status | Mitigation |
|---|---:|---|---|
| Evidence archive contains credential categories and PII-bearing artifacts | Critical | open | Exclude from repo, document rotation, do not print values. |
| Legacy `/v1/turn` active route sends Meta messages inside a DB transaction | Critical | mitigated_locally | The route is disabled by default behind `ACTIVE_TURN_COMPAT_ENABLED`; new direct Meta ingress uses durable inbox/outbox. |
| Legacy `/v1/turn` active route can fall back to legacy after definite Meta rejection | High | mitigated_locally | The route is disabled by default behind `ACTIVE_TURN_COMPAT_ENABLED`; new edge-owned durable inbound processing ignores legacy-owned conversations and enqueues outbound effects transactionally. |
| Legacy `edge_outbox` compatibility worker can retry forever | High | mitigated_locally | Legacy `edge_outbox` now has a terminal `dead_lettered` status after bounded retries; durable runtime outbox already has leases, bounded attempts, and dead letters. |
| Webhook verification tokens can appear in request URLs | High | mitigated_locally | Request logging redacts sensitive query parameters, including Meta `hub.verify_token`, and authentication/signature headers before emission. |
| Deployment verification can expose secrets through process arguments or child environments | High | mitigated_locally | `scripts/verify-deployment.sh` keeps sourced env values shell-local, passes shared-secret headers through private temporary header files, and passes the Meta challenge URL through a private curl config file. |
| API and worker both run migrations at startup | High | mitigated_locally | One-shot migrator added; local concurrent migration test passed. |
| No complete Airtable export is present | High | owner_action_pending | Build importer/dry-run/reconciliation and await owner export. |
| Local `pg_restore` cannot inspect supplied dumps | Medium | workaround_available | Use PostgreSQL 16+ Docker tooling for dump metadata and restore tests. |
| No lockfile in supplied canonical source | Medium | mitigated_locally | `package-lock.json` generated; `npm ci` verified. |
| Docker daemon unavailable in local environment | Medium | open | Static Compose validation passed; image build/run and Docker-based dump inspection require daemon access. |
