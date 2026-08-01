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

N8n removal requires no open, parked, or dead-lettered edge outbox target to n8n, no n8n scheduled authority, no unresolved or dead-lettered n8n inbox callbacks, no rejected n8n salesperson commands, no new Typebot conversation, no active legacy conversation for 14 days, direct ingress stable for 14 days, final workflow/DB export, and explicit owner approval.

Direct-ingress stability requires the current environment to have direct ingress enabled with a fresh operational runtime worker heartbeat whose metadata includes the enabled direct-ingress providers and event types. Old processed direct-ingress rows are not sufficient when the current route or worker state no longer proves Edge-owned durable processing.

Stability evidence must match the currently enabled direct-ingress route family. Enabled direct Meta ingress needs aged processed Meta inbound-message evidence. Enabled direct lead ingress needs aged processed website or Facebook lead evidence. Ignored probes and provider delivery-status callbacks do not satisfy this requirement.

Processed n8n delivery-status callbacks older than the stability window remain delivery/reporting evidence. They do not extend the n8n decommission window unless their durable inbox row is unresolved, dead-lettered, or recent enough to fail `no_recent_n8n_compat_usage`.

`ACTIVE_TURN_COMPAT_ENABLED` must be false before decommission. The readiness report exposes this as `active_turn_compat_disabled`; do not treat n8n/Typebot fallback as removable while the legacy synchronous active-turn path is still enabled.

Typebot removal requires no resumable legacy session, all content in versioned config, at least 100 successful real edge qualifications, appointment/media paths migrated, and explicit owner approval.

Airtable removal requires projection-only operation for 30 days, no production reads, no pending, failed, cancelled, dead-lettered, or ambiguous projection commands, stable reconciliation, final export, operator tooling, and explicit owner approval.

## Prohibited Without Separate Approval

- Delete n8n, Typebot, Airtable, MinIO, PostgreSQL databases, volumes, or production artifacts.
- Remove Caddy fallback routes.
- Rotate credentials.
- Mutate provider accounts.
- Send real customer messages solely for decommission testing.
