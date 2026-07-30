# Work Queue

Last updated: 2026-07-30

## MP-01 Baseline, Security, Source Cleanup

Status: locally_verified

Deliverables: clean repository, strict ignore rules, sanitized fixtures, owner-action docs, source inventory, duplicate-tree decision.

Dependencies: none.

Verification gates: clean artifact scan, `npm ci`, lint, tests, build, audit, smoke.

Remaining: none except ongoing secret hygiene.

## MP-02 Build, Deployment, Migrations, Recovery

Status: locally_verified

Deliverables: lockfile, fixed compiled paths, one-shot migrator, migration checksums/advisory lock, readiness, worker heartbeat, backup/restore scripts.

Dependencies: Docker daemon for image run and Docker-based dump inspection.

Verification gates: serial npm gate, disposable PostgreSQL migration/idempotency/checksum/concurrency, backup/restore, readiness, heartbeat.

Remaining: Docker image run and dump metadata inspection when daemon is available.

## MP-03 PostgreSQL Core And Airtable Migration

Status: locally_verified

Deliverables: app/runtime/configuration/audit/migration schemas, per-table importer, raw records, reject capture, entity maps, relationship validation, collision reporting, dry-run/apply summaries, reconciliation report, projection readiness.

Dependencies: complete Airtable export for production reconciliation.

Verification gates: synthetic malformed/duplicate/missing-relationship fixtures, idempotent rerun, partial failure rollback, disposable PostgreSQL apply/reconcile, documented field map.

Remaining: configuration publication adapters for Questions/Question Options/Conversation Messages in MP-06, Events import, projection readiness, broader real-export reconciliation checks, full reconciliation blocked on export.

## MP-04 Durable Inbox, Outbox, Jobs, Audit

Status: locally_verified

Deliverables: inbox receipt/claim/retry/dead-letter/replay, outbox commands/attempt history/provider failure classification, scheduled jobs, audit service.

Dependencies: none for internal implementation.

Verification gates: real PostgreSQL concurrency/lease/retry/dead-letter/atomicity/job/audit tests.

Remaining: provider-specific dispatchers and business processors are intentionally deferred to MP-05 through MP-10. The runtime worker is present but disabled unless real handlers are configured.

## MP-05 WhatsApp Messaging Platform

Status: staging_blocked

Deliverables: internal message request API, Meta adapter, templates, window policy, status events, delivery unknown handling, n8n compatibility route.

Dependencies: Meta credentials/templates for live verification.

Verification gates: contract fixtures for payloads/status/errors/timeouts; durable outbox dispatcher integration; live staging pending owner action.

Remaining: live staging verification pending owner action for rotated credentials, approved templates, callback URL, status webhook subscription, and test recipient.

## MP-06 Versioned Configuration

Status: staging_blocked

Deliverables: import/validate/diff/publish/rollback/active CLI, immutable published config, conversation pins to immutable configuration version IDs with legacy `config_version` compatibility, and Airtable export compilation for Questions, Question Options, and Conversation Messages.

Dependencies: complete config source for final parity.

Verification gates: invalid config rejection, seed/export parity compile, rollback, conversation pinning.

Remaining: final real-export config-source reconciliation is blocked until the owner supplies the complete Airtable export or rotated Airtable access.

## MP-07 Lead Intake And CRM

Status: staging_blocked

Deliverables: authenticated lead intake, contact/lead upsert policy, project matching, first-contact enqueue, Airtable projection-only hook.

Dependencies: real website/Facebook configuration for live verification.

Verification gates: idempotent intake, opted-out suppression, projection failure isolation.

Remaining: live website/Facebook intake verification and live Airtable projection verification pending owner source/Airtable configuration.

## MP-08 Conversation And Qualification

Status: staging_blocked

Deliverables: edge-owned Meta ingress processing, qualification sessions/answers, opt-out/takeover, Typebot drain policy.

Dependencies: staged Meta webhook for live turns.

Verification gates: internal turns, Arabic/English fixtures, no external HTTP in transaction.

Completed locally: durable Meta message receipt for signed webhook payloads, authenticated n8n-compatible inbound receipt, combined Meta inbox processor for status and inbound message events, edge-only ownership gate, legacy-owned Typebot fallback ignore path, qualification answer persistence, audit event recording, transactional outbound WhatsApp outbox enqueue without live Meta calls, explicit opt-out persistence to Edge/app lead/contact/control state, human-takeover suppression without outbound side effects, English/Arabic final-question completion, completed qualification sessions with configuration pins, qualified lead-state persistence, replay idempotency for final handoff effects, and source-to-app projection for app conversations, inbound app messages, outbound app messages, and qualification sessions.

Remaining: live staged Meta/n8n turn verification pending owner setup. Broader full-conversation fixtures can be added as hardening, but the locally implementable core path has PostgreSQL/API coverage.

## MP-09 Scoring, Routing, Commands, Alerts

Status: implementing

Deliverables: `real_estate_v1` scoring, deterministic routing, salesperson commands, authorized alerts.

Dependencies: salesperson/project export for final data parity.

Verification gates: parity fixtures, cross-client rejection, deterministic tie-breaks.

Completed locally: deterministic `real_estate_v1` score calculation from normalized qualification answers and lead state; score-run idempotency using scoring version plus input hash; atomic update of `app.leads.lead_score` and `app.leads.temperature`; `lead.scored` audit events; deterministic `real_estate_v1` routing runs with same-client/project salesperson eligibility; cross-client salesperson rejection even when project links are malformed; stable candidate tie-breaks; active-assignment reuse on rerun; durable `salesperson.lead_assignment_notification` and `operator.routing_attention_required` outbox commands; authenticated n8n-compatible salesperson command receipt into `runtime.inbox_events`; durable command processing for acknowledgement, takeover, close-lost, and stop-follow-up; unauthorized sender rejection; PostgreSQL/API integration coverage for completed qualification scoring, duplicate reruns, missing-answer reporting, routing tie-breaks, no-eligible routing, cross-client rejection, duplicate command idempotency, unauthorized command rejection, and command state mutations.

Remaining: alert/notification dispatch adapter and worker behavior for `salesperson.lead_assignment_notification` and `operator.routing_attention_required`; live parity against real salesperson/project export when available.

## MP-10 Follow-ups, SLA, Reporting

Status: not_started

Deliverables: durable scheduled followups, SLA reminders/escalations, daily reports.

Dependencies: client report recipients/templates for live sends.

Verification gates: durable job restart, cancellation, SQL reconciliation.

Remaining: all.

## MP-11 Appointments And Calendar

Status: not_started

Deliverables: offer generation, slot persistence/locking, Google availability/recheck/create-event adapter.

Dependencies: Google Calendar credentials for live verification.

Verification gates: concurrent booking, duplicate reply, provider failure handling.

Remaining: all.

## MP-12 Direct Ingress, Rollout, Decommission

Status: not_started

Deliverables: direct callback compatibility, Caddy route plan, rollout overrides, decommission criteria/runbooks.

Dependencies: DNS/Caddy/production owner action.

Verification gates: staging ingress, canary metrics, explicit owner approval for removals.

Remaining: all.
