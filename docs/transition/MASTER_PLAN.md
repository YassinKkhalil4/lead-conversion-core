# Master Plan

## Objective

Move lead conversion authority from Airtable, n8n, Typebot, and canary Conversation Edge state into one PostgreSQL-backed modular monolith with durable ingress, durable outbox, scheduled jobs, versioned configuration, migration tooling, operator runbooks, and metrics.

## Source Baseline

- Evidence root: `/Users/yassinkhalil/Downloads/automation-20260729-220630/public`
- Clean repository: `/Users/yassinkhalil/Developer/lead-conversion-core`
- Initial source: reviewed copy of `source/conversation-edge`
- Duplicate comparison: `source/lead-conversion-os-active-test-v2/conversation-edge` is byte-identical to `source/conversation-edge`
- Excluded: `.env*`, dumps, Docker inspect output, resolved secret-bearing Compose files, encrypted credentials, MinIO archives, `dist`, `node_modules`

## Verified Inventory

- n8n export: 44 workflows, 43 active, 1 inactive, 523 nodes
- Current edge stack: Node.js 22+, TypeScript, Fastify, `pg`, Zod, Pino, `prom-client`, Vitest, PostgreSQL 16
- Current routes: `/health`, `/ready`, `/metrics`, `/v1/turn`, `/v1/shadow/evaluate`, internal config/channel/consumer/conversation/outbox endpoints
- Current migrations: `edge_schema_migrations`, `edge_config_snapshots`, `edge_client_channels`, `edge_conversations`, `edge_message_events`, `edge_shadow_evaluations`, `edge_outbox`, `edge_lead_controls`, `edge_consumer_receipts`, `edge_ownership_audit`, `edge_active_turns`

## Workflow Replacement Map

| Existing workflow | Target module |
|---|---|
| 00 | Dead-letter and incident handling |
| 00A | `audit.events` |
| 00B | Notification outbox |
| 00C | Client/config repositories |
| 00D | Phone value object |
| 00E | Suppression policy |
| 00F | Delete after PostgreSQL migration |
| 00H | Delete after single authority |
| 00I | Internal domain handlers |
| 00J | Rollout override CLI |
| 00K | Configuration importer/publisher |
| 01 | Intake service |
| 01A | Intake normalizer |
| 01B | Contact/lead upsert |
| 01C | Project matcher |
| 01D | Lead service |
| 01E | Facebook adapter, disabled until configured |
| 01F | Website and internal test adapters |
| 04 | Message service |
| 04A | WhatsApp policy/payload builder |
| 04B | Meta worker handler |
| 04C | Messages/delivery state |
| 05-GW | Meta ingress and inbox |
| 05A | Meta event parser |
| 05B | Delivery status service |
| 05C | Contact/lead repository |
| 05D | Message persistence |
| 05E | Contact suppression |
| 05F | Sales command service |
| 05G | Human takeover service |
| 06-CFG | In-process config repository |
| 06-TB | Qualification service |
| 06A | Qualification repository |
| 06D | Answer/session transaction |
| 07 | Delete/disable until a real AI feature exists |
| 08 | Versioned scoring |
| 09 | Routing/assignment |
| 10 | Assignment notification |
| 11 | Appointment service |
| 12 | Follow-up service |
| 13 | Scheduler worker |
| 14 | Assignment-specific SLA jobs |
| 15 | Report jobs |
| My workflow | Delete |

## MP-01 Exit Criteria

- Clean canonical repository exists.
- No known secret-bearing artifact is tracked.
- Required Airtable export is documented.
- Current behavior fixtures exist.
- No production behavior changed.

## MP-02 Exit Criteria

- Fresh deployment is reproducible.
- Concurrent migrators cannot race.
- Changed applied migration is rejected.
- API/worker health is meaningful.
- Restore succeeds locally with compatible PostgreSQL tooling.
- Existing business behavior unchanged.
