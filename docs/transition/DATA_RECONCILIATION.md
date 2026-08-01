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
- Import dry-run reports manifest presence/errors, per-table load errors, and rejection reasons.
- Apply mode stores raw records and rejected records under a migration import run.
- Initial domain entity upserts are idempotent for clients, projects, salespeople, contacts, and leads.
- `npm run reconcile:airtable -- --record-results` records checks for rejects, mapped clients/projects/salespeople/leads/qualifications/scores/messages/followups/appointments/events, contact phone uniqueness, and lead-contact links.
- Full reconciliation remains blocked on complete Airtable export.
