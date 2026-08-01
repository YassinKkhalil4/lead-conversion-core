# Data Reconciliation

Before PostgreSQL authority is enabled for migrated capabilities, reconciliation must compare:

- Row counts by table/entity
- Valid and rejected counts
- Client links
- Project links
- Contact phone uniqueness
- Active lead counts
- Status distribution
- Opt-out count
- Open assignment count
- Pending follow-up count
- Open/booked appointment count
- Message count and provider-ID uniqueness

Current external status: pending complete Airtable export.

Current local tooling status:

- Import dry-run reports missing tables, valid count, and rejected count.
- Import dry-run reports duplicate phone/email collisions for source Leads and Salespeople rows.
- Import dry-run reports manifest presence/errors, per-table load errors, and rejection reasons.
- Apply mode stores raw records and rejected records under a migration import run.
- Initial domain entity upserts are idempotent for clients, projects, salespeople, contacts, and leads.
- `npm run reconcile:airtable -- --record-results` records checks for rejects, accepted-row mapped clients/projects/salespeople/leads/qualifications/scores/messages/followups/appointments/events, lead status distribution, active lead counts, stop-follow-up counts, opt-out counts, pending follow-up counts, open/booked appointment counts, message provider-ID uniqueness, contact phone uniqueness, and lead-contact links.
- Rejected Airtable rows fail reconciliation until resolved; mapped-count checks separately report raw, rejected, and accepted counts so correctly rejected rows do not masquerade as missing target rows.
- Distribution and business-count checks are limited to accepted source rows joined through `migration.entity_map`; unresolved or rejected rows remain visible through reject checks instead of being silently inferred.
- Full reconciliation remains blocked on complete Airtable export.
