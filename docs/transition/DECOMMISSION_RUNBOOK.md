# Decommission Runbook

Status: blocked on owner approval and exit criteria.

## Read-Only Readiness Report

Run this against the intended environment before any removal:

```bash
npm run decommission:readiness -- \
  --direct-stability-days=14 \
  --min-completed-edge-qualifications=100 \
  --max-worker-heartbeat-age-seconds=120
```

Only add these flags when the matching evidence is complete and owner-approved:

- `--final-legacy-export-complete`
- `--final-airtable-export-complete`
- `--appointment-media-migrated`
- `--airtable-projection-only-verified`
- `--owner-approved-n8n`
- `--owner-approved-typebot`
- `--owner-approved-airtable`

The command is read-only. A passing report is a decommission precondition, not approval to delete or disable infrastructure.

## Exit Criteria

N8n removal requires `N8N_COMPAT_ROUTES_ENABLED=false`, no open, parked, or dead-lettered edge outbox target to n8n, no n8n scheduled authority, no unresolved or dead-lettered n8n inbox callbacks, no rejected n8n salesperson commands, no new Typebot conversation, no recent legacy conversation activity, no active legacy conversation for 14 days, direct ingress stable for 14 days, final workflow/DB export, and explicit owner approval.

Direct-ingress stability requires the current environment to have direct ingress enabled with a fresh operational runtime worker heartbeat whose metadata includes the enabled direct-ingress providers and event types. Old processed direct-ingress rows are not sufficient when the current route or worker state no longer proves Edge-owned durable processing. Legacy stability also requires no legacy-owned conversation activity inside the window; old terminal legacy conversations with recent updates or inbound timestamps still block n8n and Typebot removal.

Stability evidence must match the currently enabled direct-ingress route family. Enabled direct Meta ingress needs aged processed Meta inbound-message evidence. Enabled direct lead ingress needs aged processed website or Facebook lead evidence. The stability window is measured from successful processing completion (`runtime.inbox_events.completed_at`), not durable receipt time (`created_at`). Ignored probes and provider delivery-status callbacks do not satisfy this requirement.

Processed n8n delivery-status callbacks older than the stability window remain delivery/reporting evidence. They do not extend the n8n decommission window unless their durable inbox row is unresolved, dead-lettered, or recent enough to fail `no_recent_n8n_compat_usage`.

`ACTIVE_TURN_COMPAT_ENABLED` must be false before decommission. The readiness report exposes this as `active_turn_compat_disabled`; do not treat n8n/Typebot fallback as removable while the legacy synchronous active-turn path is still enabled.

`N8N_COMPAT_ROUTES_ENABLED` must be false before n8n decommission. The readiness report exposes this as `n8n_compatibility_routes_disabled`; do not treat n8n fallback as removable while Edge still accepts n8n-compatible callbacks.

Typebot removal requires no resumable legacy session, all content in versioned config, at least 100 successful real edge qualifications, appointment/media paths migrated, and explicit owner approval. All active `edge_config_snapshots` rows must have matching published immutable `configuration.versions` rows before Typebot removal can pass; compatibility snapshots may remain only when they mirror versioned configuration.

Airtable removal requires projection-only operation for 30 days, no production reads, no pending, failed, cancelled, dead-lettered, or ambiguous projection commands, stable reconciliation, final export, operator tooling, and explicit owner approval. Stable reconciliation means the required Airtable reconciliation suite has recorded every required check key and every recorded reconciliation result is `pass`; a partial passing subset is not enough.

## Prohibited Without Separate Approval

- Delete n8n, Typebot, Airtable, MinIO, PostgreSQL databases, volumes, or production artifacts.
- Remove Caddy fallback routes.
- Rotate credentials.
- Mutate provider accounts.
- Send real customer messages solely for decommission testing.
