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
- Initial apply mappings: Clients, Projects, Salespeople, Contacts derived from Leads, Leads

Pending:

- Complete owner export
- Full mappings for questions/options/conversation messages/qualifications/messages/assignments/follow-ups/appointments/scores/events
- Count and linked-record reconciliation against real export
