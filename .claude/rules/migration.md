# Migration Rules

- Preserve the original evidence archive unchanged.
- Store raw imported records before transformation.
- Use content hashes and idempotency keys for repeatable imports.
- Preserve legacy IDs only for migration and audit linkage.
- Reject invalid records explicitly with reasons; do not silently drop data.
- Reconcile counts, linked records, status distributions, opt-outs, assignments, follow-ups, appointments, messages, and provider IDs before switching authority.
- Do not delete n8n, Typebot, Airtable, databases, volumes, or Caddy routes without explicit owner approval.
