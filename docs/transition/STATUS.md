# Transition Status

Last updated: 2026-07-30

| Mini-project | Status | Verification level | Notes |
|---|---|---|---|
| MP-01 Baseline, security, source cleanup | locally_verified | local file inspection and source tests | Clean repo created from canonical source. Secret-bearing archive artifacts excluded. Current behavior fixtures added. |
| MP-02 Build, deployment, migrations, recovery | locally_verified | local npm, PostgreSQL, backup/restore tests | Lockfile, fixed scripts, single migrator, checksums, advisory lock, heartbeat, readiness, backup/restore verified locally. Docker daemon unavailable for image run. |
| MP-03 PostgreSQL core and Airtable migration | locally_verified | local PostgreSQL integration tested for schema, importer, and reconciliation foundations | Target schemas/tables added. Importer supports JSON/CSV dry-run, manifest awareness, stable ID enforcement, duplicate/reject reporting, relationship rejection, raw records, clients, projects, salespeople, contacts, leads, qualifications, scores, messages, follow-ups, and appointments. Complete Airtable export still pending for production reconciliation. |
| MP-04 Durable inbox, outbox, jobs, audit | locally_verified | local PostgreSQL integration tested for dedupe, leases, retry, dead-lettering, atomicity, jobs, worker orchestration, replay, and audit append-only behavior | New durable runtime foundation added alongside legacy `edge_outbox` compatibility path. Runtime worker is disabled unless configured and only claims work when real handlers are provided. |
| MP-05 WhatsApp messaging platform | implementing | local contract fixtures for Meta send classification and dispatcher mapping | Provider-neutral messaging port, disabled Meta WhatsApp adapter shape, and durable outbox dispatcher mapping added. Current direct Meta send remains in active turn service until message request API, status ingestion, and cutover gates are implemented. |
| MP-06 Versioned configuration | not_started | none | Current config is Airtable-shaped snapshot. |
| MP-07 Lead intake and CRM | not_started | none | Current intake authority remains n8n/Airtable. |
| MP-08 Conversation and qualification | not_started | none | Current edge is active-test/canary only. |
| MP-09 Scoring, routing, commands, alerts | not_started | none | Workflow parity pending. |
| MP-10 Follow-ups, SLA, reporting | not_started | none | Workflow parity pending. |
| MP-11 Appointments and Calendar | not_started | none | Google Calendar credentials absent. |
| MP-12 Direct ingress, rollout, decommission | not_started | none | Caddy still routes WhatsApp ingress to n8n. |

Allowed statuses: `not_started`, `investigating`, `implementing`, `locally_verified`, `staging_blocked`, `staging_verified`, `production_canary`, `completed`.
