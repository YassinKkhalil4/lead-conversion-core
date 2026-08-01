# Data Migration

The complete Airtable export is not present in the supplied evidence archive. Migration tooling must accept either a complete owner-provided table export or a least-privilege API export using rotated credentials supplied only through environment configuration.

Raw records must be stored before transformation. Every transformed entity must be mapped through `migration.entity_map`; invalid records must be stored in `migration.rejected_records` with reasons.

Initial import order:

1. Clients
2. Projects
3. Salespeople
4. Questions
5. Question Options
6. Conversation Messages
7. Contacts derived from Leads
8. Leads
9. Qualifications
10. Scores
11. Messages
12. Assignments derived from Leads
13. FollowUps
14. Appointments
15. Events

## Current Implementation

Implemented locally:

- Additive schemas: `app`, `configuration`, `audit`, `migration`
- Runtime queue tables: webhook receipts, inbox events, outbox commands, scheduled jobs, dead letters, rollout tables
- Migration tables: import runs, raw Airtable records, entity map, rejected records, reconciliation results
- Importer command: `npm run import:airtable -- --input=<dir>` for dry-run
- Apply command: `npm run import:airtable -- --input=<dir> --apply`
- Supported file formats: per-table JSON and CSV
- Optional manifest: `airtable-export-manifest.json`
- Stable Airtable record IDs are required; missing or duplicate IDs are rejected.
- Invalid lead/salesperson phone values are rejected.
- Dry-run reports duplicate phone/email collisions for source Leads and Salespeople rows using normalized values.
- Lead contact opt-out is preserved when `Consent Status` is one of `opted_out`, `opted out`, `unsubscribed`, `withdrawn`, `revoked`, or `no_consent`, or when `Opted Out` is `true`, `yes`, or `1`.
- Missing mapped client/project relationships are rejected rather than invented.
- Initial apply mappings: Clients, Projects, Salespeople, Contacts derived from Leads, Leads, Qualifications, Scores, Messages, FollowUps, Appointments, Events
- Events import into `audit.events` as historical migration actor records, redact secret-like payload keys, preserve source record IDs in `migration.entity_map`, and reject unresolved client/lead links rather than inventing relationships.
- Provisional field map: `docs/transition/AIRTABLE_FIELD_MAP.md`

Pending:

- Complete owner export
- Full real-export reconciliation for questions/options/conversation messages
- Count and linked-record reconciliation against real export
