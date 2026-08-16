# Implementation Ledger

## 2026-07-30

- Commit `7ba47c2`: Established clean repository from reviewed `source/conversation-edge`; added transition docs, owner-action docs, strict ignore rules, lockfile, migrator checksums/advisory lock, runtime heartbeat foundation, backup/restore scripts, and source tests.
- Commit `df90f61`: Added app/runtime/configuration/audit/migration schemas and initial Airtable import foundation for raw records, rejects, clients, projects, salespeople, contacts, and leads.
- Commit `d0e751a`: Added Airtable reconciliation checks and recording.
- Verification failure: first parallel audit command ran `npm ci`, lint, test, and build concurrently. Lint/test/build failed transiently because `node_modules` was being replaced. Resolution: reran gates serially after `npm ci`, and serial gates passed.
- Deferred external verification: Docker daemon unavailable for image run and Docker-based dump metadata inspection.
- Deferred external verification: real Airtable export unavailable for production reconciliation.
- Deferred external verification: Meta, Google Calendar, and Facebook credentials unavailable for live provider validation.
- Implementation slice: Converted repository instructions from Claude-specific `CLAUDE.md` and `.claude/rules/` into Codex `AGENTS.md`; added `WORK_QUEUE.md`, `NEXT_ACTION.md`, and `IMPLEMENTATION_LEDGER.md`.
- Decision: Missing Airtable record IDs are rejected instead of synthesized to preserve idempotent source identity.
- Decision: `/ready` must prove all migration files have applied, not merely that PostgreSQL is reachable.
- Verification failure: parallel `npm ci` with lint/test/build caused transient missing modules/types while `node_modules` was replaced. Resolution: reran serially; serial gate passed.
- Verification failure: importer rollback test initially reused `recPROJECT001`, causing a false positive raw-record count. Resolution: changed failing fixture to unique `recPROJECTSQLBAD`; test passed.
- Implementation slice: Hardened importer manifest/rejection behavior, added provisional Airtable field map, improved restore verification, and added PostgreSQL-backed importer tests for idempotency, missing relationships, and rollback.
- Commit `52721ad`: Converted repository instructions to Codex `AGENTS.md`, removed Claude-specific files, added persistent work queue/next-action/ledger, hardened MP-03 importer audit behavior, and verified with npm/source/PostgreSQL gates.
- Implementation slice: Added historical import adapters for Qualifications, Scores, Messages, FollowUps, and Appointments. Expanded synthetic export fixtures and reconciliation to 12 checks.
- Commit `416a077`: Expanded Airtable historical import adapters and reconciliation checks for qualifications, scores, messages, follow-ups, and appointments.
- Implementation slice: Added MP-04 durable runtime hardening migration for inbox receipts/events, outbox commands, scheduled jobs, attempt history, dead letters, and append-only audit metadata.
- Implementation slice: Added runtime repositories for durable inbox receive/dedupe/claim/retry/dead-letter/ignore/replay, transactional outbox enqueue/claim/delivery/retry/permanent-failure/delivery-unknown handling, scheduled job schedule/cancel/claim/complete/retry, and audit event recording.
- Implementation slice: Added disabled-by-default runtime worker with explicit handler boundary for inbox, outbox, and scheduled job processing. Legacy `edge_outbox` worker remains available for compatibility until cutover evidence exists.
- Decision: Runtime worker does not claim provider side effects unless a real dispatcher is configured; tests may inject handlers, but production code must not simulate successful sends.
- Verification: `npm run lint && npm test` passed with 5 Vitest files and 31 tests after MP-04 runtime implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `e4d1907`: Added durable runtime queue foundations for inbox/outbox/jobs/audit plus PostgreSQL integration tests and transition documentation.
- Commit `60990c0`: Recorded MP-05 next-action transition state after the MP-04 runtime foundation commit.
- Implementation slice: Added provider-neutral messaging types and disabled-by-default Meta WhatsApp adapter that classifies accepted, retryable, permanently failed, and delivery-unknown outcomes from provider response shapes.
- Verification: `npm run lint && npm test` passed with 6 Vitest files and 37 tests after the MP-05 Meta adapter contract fixtures were added.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Deferred external verification: live Meta send/status verification remains pending rotated credentials, approved templates, and staging webhook access.
- Commit `b0fbd16`: Added provider-neutral messaging contract, disabled Meta WhatsApp adapter, sanitized provider fixtures, and adapter classification tests.
- Implementation slice: Added `MessagingOutboxDispatcher` for `whatsapp.send_message` runtime outbox commands, mapping Meta accepted/retryable/permanent/unknown outcomes onto runtime worker dispatch outcomes without database transactions around provider calls.
- Implementation slice: Wired `WORKER_KIND=runtime` to use the messaging dispatcher only when `DIRECT_META_SEND_ENABLED=true`; when disabled, the runtime worker does not claim message side-effect rows.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 41 tests after durable outbox dispatcher wiring.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `fcabd0c`: Wired WhatsApp runtime outbox dispatcher and gated runtime worker dispatch on explicit Meta send enablement.
- Implementation slice: Added migration `008_message_request_idempotency.sql`, internal message request service, and authenticated `/internal/messages/whatsapp/send` route. The service inserts `app.messages`, enqueues `runtime.outbox_commands`, and records audit in one transaction without calling Meta.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 43 tests after message request API/service implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `21d307e`: Added internal WhatsApp message request API/service and message idempotency migration.
- Implementation slice: Added WhatsApp template payload support, approved-template allow-list enforcement, and session-message conversation-window enforcement before outbound requests persist or enqueue.
- Implementation slice: Removed redundant deprecated Fastify `disableRequestLogging=false` option; default request logging behavior is unchanged and verification output no longer includes the deprecation warning.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 45 tests after template/window policy implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `58c6e33`: Enforced WhatsApp approved-template and session-window policy before message request enqueue.
- Implementation slice: Added migration `009_message_status_ingestion.sql`, raw-body capture for the Meta webhook route, signed Meta WhatsApp webhook receipt into durable inbox, status event extraction, status processor, message delivery event idempotency, message state updates, and audit recording.
- Implementation slice: Updated runtime inbox claims with provider/event metadata and updated outbox delivered handling to copy provider message IDs onto `app.messages` rows for later status matching.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 47 tests after Meta status webhook ingestion implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Deferred external verification: live Meta webhook challenge/status delivery remains pending rotated Meta app secret, verification token, callback URL, and subscribed test webhook events.
- Commit `e133c40`: Added Meta WhatsApp status webhook durable inbox receipt, processing, delivery-event persistence, and local PostgreSQL/API tests.
- Implementation slice: Added n8n compatibility routes for WhatsApp send requests and status acknowledgements behind `N8N_COMPAT_ROUTES_ENABLED`, backed by internal message request service, runtime outbox, and durable inbox status processing.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 49 tests after n8n compatibility route implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Deferred external verification: MP-05 live staging remains blocked on owner Meta credentials, approved templates, callback URL, webhook subscription, and test recipient.
- Commit `f516fc6`: Added n8n WhatsApp compatibility send and status routes behind an explicit compatibility flag.
- Implementation slice: Began MP-06 with migration `010_versioned_configuration.sql`, immutable published config guard, `configuration.active_versions`, versioned config validation/diff/publish service, and `npm run config` CLI.
- Implementation slice: Versioned config publish also maintains `edge_config_snapshots` in the same transaction as a rollback/compatibility path.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 50 tests after MP-06 foundation implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Verification: `npm run config -- validate --input=config/seed-real-estate.json` passed with dummy local env values and reported 9 questions and 7 messages.
- Commit `cc7a0d4`: Added versioned configuration foundation with immutable published versions, active pointers, config CLI, and PostgreSQL tests.
- Implementation slice: Added configuration active metadata/rollback activation, `npm run config -- active`, `npm run config -- rollback --version=...`, and runtime `ConfigRepository` reads from `configuration.active_versions` with legacy snapshot fallback.
- Verification: `npm run lint && npm test` passed with 7 Vitest files and 51 tests after active/rollback configuration implementation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `f3423da`: Added configuration active/rollback flow and runtime reads from versioned configuration.
- Implementation slice: Added invalid configuration fixture coverage for no active questions and deterministic config diff tests.
- Verification: `npm run lint && npm test` passed with 8 Vitest files and 53 tests after invalid configuration fixture tests were added.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `9e9e510`: Added invalid configuration validation fixtures and deterministic diff tests.
- Implementation slice: Added migration `011_conversation_configuration_pin.sql`, runtime config metadata reads, conversation repository UUID pinning, shadow-evaluator creation pins, and authenticated bootstrap re-pin support through the existing `migrateConfig` flag.
- Decision: Existing conversations remain pinned to their original `config_version` and `configuration_version_id`; only explicit bootstrap migration can move both pins.
- Verification: `npm run lint`, `npm test`, and `npm run build` passed after the conversation-pin implementation; Vitest ran 8 files and 54 tests.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; audit found 0 vulnerabilities and smoke returned `ok=true`.
- Commit `38390e8`: Pinned conversations to immutable configuration version IDs while preserving legacy `config_version` compatibility.
- Implementation slice: Added Airtable configuration export compilation for Questions, Question Options, and Conversation Messages, including CSV/JSON loading, stable record ID enforcement, duplicate rejection, active/link/text validation, seed/export deterministic version parity, CLI `--airtable-export` validation, and publish-from-export support.
- Decision: MP-06 config export publication rejects malformed rows before publish and does not infer unsupported field mappings beyond the documented provisional configuration field map.
- Verification: `npm run lint` and `npx vitest run tests/config-versioning.test.ts` passed; focused config tests ran 4 tests.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 56 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: final MP-06 config-source reconciliation against the real Airtable export remains pending owner action.
- Commit `bb8314a`: Added Airtable configuration export parity.
- Implementation slice: Began MP-07 with authenticated `/internal/leads/intake`, `LeadIntakeService`, idempotent contact/lead/intake-event upserts, deterministic fallback lead idempotency keys, project matching by ID/legacy ID/name, audit recording, opted-out first-contact suppression, and first-contact message/outbox enqueue in the same PostgreSQL transaction.
- Decision: First contact from lead intake requires an approved WhatsApp template and never calls Meta directly; the command only inserts `app.messages` and `runtime.outbox_commands`.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 23 PostgreSQL/API tests including lead intake idempotency and opt-out suppression.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 58 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live website/Facebook lead intake remains pending owner source configuration.
- Commit `c2dadf2`: Added the internal lead intake command.
- Implementation slice: Added `/webhooks/leads/website` and `/webhooks/leads/facebook` source-specific ingress adapters protected by `EDGE_SHARED_SECRET`, durable raw receipt into `runtime.inbox_events`, invalid-payload ignore handling, sanitized website/Facebook contract mapping, and processing through `LeadIntakeService` without live source-provider API calls.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 26 PostgreSQL/API tests including processed website/Facebook inbox receipts and ignored invalid website receipt.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 61 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live website/Facebook webhook verification remains pending owner source configuration and callback setup.
- Commit `0923e79`: Added durable website/Facebook lead source ingress adapters.
- Implementation slice: Added durable Airtable read-only lead visibility projection hook as `runtime.outbox_commands` command type `airtable.project_lead_visibility`, with deterministic idempotency and ID-only payload. Projection failure is isolated to the outbox/dead-letter path and does not roll back authoritative lead/contact/intake state.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 26 PostgreSQL/API tests including projection outbox creation and permanent projection failure preserving the lead row.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 61 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live Airtable projection remains pending owner Airtable export/access and projection target confirmation.
- Commit `b865b26`: Added Airtable lead projection outbox hook.
- Implementation slice: Began MP-08 by adding migration `012_edge_active_turn_queued_status.sql`, durable Meta inbound message extraction, `EdgeInboundMessageProcessor`, and `MetaInboxProcessor`. Signed Meta message webhooks now durably store raw inbound messages before processing, runtime workers mutate only edge-owned conversations, persist qualification answers, enqueue outbound WhatsApp commands in the same transaction as conversation state updates, and record `conversation.inbound_processed` audit events.
- Decision: Edge inbound message processing ignores legacy-owned conversations and records the durable inbox item as ignored so Typebot remains authoritative during cutover.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 28 PostgreSQL/API tests including signed inbound Meta receipt, durable worker processing, qualification answer persistence, transactional outbound outbox enqueue, audit recording, and legacy-owned Typebot fallback ignore behavior.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, and `npm run test:smoke` passed; Vitest ran 8 files and 63 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live Meta inbound conversation turn verification remains pending rotated Meta credentials, callback URL, webhook subscription, and staged test recipient.
- Commit `c104fd2`: Added durable Meta inbound conversation processor.
- Implementation slice: Added durable inbound opt-out and human-takeover handling. Explicit opt-out text updates `edge_conversations`, `edge_lead_controls`, `app.leads`, and `app.contacts`, records suppression audit metadata, and suppresses outbound WhatsApp side effects. Human-takeover conversations preserve current qualification state, record a control snapshot, and suppress outbound side effects while remaining durably processed.
- Decision: Durable opt-outs do not enqueue a confirmation reply; they stop outbound effects immediately until a provider/legal-approved confirmation policy is explicitly configured.
- Verification failure: the first full `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` run failed because `tests/config-versioning.test.ts` spawned `npm run config` and exceeded Vitest's 5 second per-test timeout under full-suite load. Resolution: changed the test to execute the same `scripts/config.ts validate --airtable-export=...` path directly through Node with `--import tsx`, preserving CLI-script validation while removing the slow npm wrapper.
- Verification: `npm run lint`, `npx vitest run tests/runtime.integration.test.ts`, and `npx vitest run tests/config-versioning.test.ts` passed; runtime integration ran 30 PostgreSQL/API tests and focused config tests ran 4 tests.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 65 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `b33a2ec`: Added durable inbound opt-out and takeover handling.
- Implementation slice: Added durable qualification completion persistence. Final-question inbound turns now pin `app.qualification_sessions` to the conversation configuration version, mark sessions completed, update `app.leads` to `qualified`, keep final answers in `app.qualification_answers`, enqueue the closing WhatsApp command transactionally, and avoid duplicate handoff/outbox effects on duplicate webhook replay.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 32 PostgreSQL/API tests including English final site-visit completion, Arabic final site-visit completion, completed session persistence, qualified lead-state persistence, and duplicate final-turn replay idempotency.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 67 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `564c8d3`: Persisted durable qualification completion.
- Implementation slice: Added migration `013_app_conversation_lead_projection.sql` and source-to-app conversation projection for durable inbound turns. Edge-owned turns now upsert `app.conversations` by lead, persist inbound app message rows with provider message IDs, attach outbound app message rows to the app conversation, and link qualification sessions to the projected app conversation while preserving replay idempotency.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 32 PostgreSQL/API tests including app conversation projection, inbound app message projection, outbound app message linkage, qualification session linkage, opt-out projection, takeover projection, and final-turn replay idempotency.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 67 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `999c7ab`: Projected durable conversations into app state.
- Implementation slice: Added authenticated n8n-compatible inbound WhatsApp route behind `N8N_COMPAT_ROUTES_ENABLED`. Sanitized n8n payloads are mapped to durable `runtime.inbox_events` with provider `n8n` and event type `whatsapp.message_received`, deduplicated by stable source event identity, and processed by the same `MetaInboxProcessor` path as direct Meta webhooks.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 33 PostgreSQL/API tests including duplicate n8n inbound receipt and Edge processing through qualification state/outbox projection.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 8 files and 68 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live MP-08 staged turn verification remains pending owner Meta/n8n callback setup and test recipient.
- Commit `f346dfd`: Added n8n inbound message compatibility route.

## 2026-07-30

- Commit `f2d19f9`: Recorded MP-08 n8n inbound state.
- Implementation slice: Began MP-09 scoring foundation with migration `014_lead_scoring_idempotency.sql`, pure `real_estate_v1` scoring rules, and `LeadScoringService`. Completed qualification turns now score the lead inside the same PostgreSQL transaction as qualification completion, update `app.leads.lead_score` and `temperature`, persist `app.score_runs` with `(lead_id, scoring_version, input_hash)` idempotency, and append `lead.scored` audit records.
- Decision: Scoring is snapshot-idempotent by scoring version and deterministic input hash; webhook replays and operator reruns of the same state reuse the same score run instead of creating duplicates.
- Verification failure: The first `npx vitest run tests/runtime.integration.test.ts` run after adding scoring failed because the scorer read only `app.qualification_answers`; MP-08 had only persisted the final answer row, while the full qualification snapshot was still in `edge_conversations.answers_json`. Resolution: `LeadScoringService.scoreLead` now accepts the completed conversation answer snapshot from `EdgeInboundMessageProcessor` and overlays it onto persisted answer rows before computing the score.
- Verification: `npm run lint`, `npx vitest run tests/lead-scoring.test.ts`, and `npx vitest run tests/runtime.integration.test.ts` passed after the scoring snapshot fix. Runtime integration ran 34 PostgreSQL/API tests including completed qualification scoring, duplicate replay preserving one score run, and missing-answer score reporting.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 71 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `e7ab270`: Added deterministic lead scoring foundation.
- Implementation slice: Continued MP-09 with migration `015_lead_routing_runs.sql`, pure `real_estate_v1` candidate ranking, and `LeadRoutingService`. Completed qualification now routes immediately after scoring inside the same PostgreSQL transaction. Routing runs persist deterministic candidate lists, selected salesperson, outcome, score-run causation, and input hash; assignments are inserted atomically with durable `salesperson.lead_assignment_notification` outbox commands; no-eligible routes can enqueue `operator.routing_attention_required` when a manager destination exists.
- Decision: Existing active assignments are authoritative for routing reruns until a later explicit reassignment/supersession command exists.
- Verification failure: The first routing integration run failed on duplicate rerun because the second route attempt hit `lead_assignments_lead_id_status_key`. Resolution: route service now locks and reuses an existing active assignment/routing run before recomputing candidates.
- Verification failure: After adding assignment reuse, the second focused run failed because recomputing candidate load after assignment selected a different salesperson. Resolution: active-assignment reuse now occurs before candidate ranking, preserving replay idempotency.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts tests/lead-scoring.test.ts` passed; focused tests ran 38 tests covering routing tie-breaks, cross-client rejection, idempotent assignment notification, and no-eligible alert creation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 73 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `e8b6cf5`: Added deterministic lead routing foundation.
- Implementation slice: Continued MP-09 with migration `016_salesperson_commands.sql`, authenticated `/compat/n8n/salesperson/commands` receipt, and `SalespersonCommandProcessor`. Sanitized salesperson commands now enter durable inbox, dedupe by stable event identity, validate that the sender is an active salesperson and active assignee for the lead/client, persist command outcomes, support `acknowledge`, `takeover`, `close_lost`, and `stop_follow_up` intents, mutate lead/assignment/control state atomically, and append processed/rejected audit events.
- Decision: Salesperson commands are durable inbox events and are not applied synchronously during webhook receipt.
- Verification failure: First lint after command ingestion failed because an audit call passed an optional aggregate ID as `undefined` under exact optional property types. Resolution: construct and include `aggregateId` only when present.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed after the optional-field fix; runtime integration ran 39 PostgreSQL/API tests including duplicate command receipt, authorized acknowledgement, unauthorized sender rejection, and close-lost command state mutation without external side effects.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 76 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `d0f7e36`: Added durable salesperson command ingestion.
- Implementation slice: Completed the local MP-09 notification dispatch foundation by extending `MessagingOutboxDispatcher` to support `salesperson.lead_assignment_notification` and `operator.routing_attention_required`. The dispatcher maps durable notification payloads into real Meta WhatsApp send commands, preserves provider accepted/retryable/permanent/unknown classification, and rejects malformed notification payloads without calling the provider.
- Decision: Notification outbox command types dispatch through the existing messaging adapter path instead of being treated as unsupported worker commands.
- Verification: `npm run lint` and `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts` passed; focused tests ran 45 tests covering notification mapping and malformed notification rejection in addition to runtime command coverage.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 78 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: MP-09 live notification send and salesperson command verification remain pending owner Meta/n8n setup, approved notification content/templates, and real salesperson/project export parity.
- Commit `229e01c`: Dispatched salesperson notification outbox commands.
- Implementation slice: Began MP-10 with migration `017_followup_scheduling.sql` and `FollowupSchedulerService`. Follow-ups now have semantic keys, runtime scheduled-job links, explicit timezone, sequence key, and step order. Scheduling writes `app.followups` and `runtime.scheduled_jobs` in PostgreSQL, duplicate schedule requests reuse existing rows without duplicate audit, and cancellation updates both application follow-up rows and runtime jobs.
- Implementation slice: Wired follow-up cancellation into durable opt-out, qualification completion, lead assignment, salesperson takeover, close-lost, and stop-follow-up paths.
- Decision: Follow-ups use semantic runtime jobs as the durable scheduling authority; no in-process timers were introduced.
- Verification failure: First MP-10 lint run failed because optional `correlationId`/`causationId` fields were passed as `undefined` under exact optional property types. Resolution: optional fields are now spread only when present.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed after the optional-field fix; runtime integration ran 40 PostgreSQL/API tests including follow-up scheduling idempotency, timezone persistence, assignment cancellation, and close-lost cancellation.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 79 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `0adcb5b`: Added durable followup scheduling foundation.
- Implementation slice: Continued MP-10 with `FollowupJobProcessor` and runtime worker registration for scheduled jobs. Claimed `followup.send` jobs now revalidate lead state, cancel stale jobs without outbound effects, insert outbound `app.messages` and `runtime.outbox_commands` atomically for eligible follow-ups, mark follow-ups sent, and record `followup.sent` audit events. Runtime worker job claiming handles expired lease recovery through the existing PostgreSQL job repository.
- Verification: `npm run lint` and `npx vitest run tests/runtime.integration.test.ts` passed; runtime integration ran 43 PostgreSQL/API tests including due follow-up execution, duplicate execution prevention, cancelled-job non-execution, and expired job lease recovery.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 82 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `daa9945`: Executed durable followup jobs.
- Implementation slice: Continued MP-10 with migration `018_sla_jobs.sql` and `SlaService`. Assignment acknowledgement reminders/escalations and stale-qualified escalations now persist semantic `app.sla_jobs` linked to `runtime.scheduled_jobs`, schedule idempotently, revalidate lead/assignment state at execution time, cancel obsolete SLA work on acknowledgement/close-lost/stop-follow-up/takeover/opt-out, and enqueue durable salesperson/operator notification outbox commands without provider calls inside transactions.
- Implementation slice: Runtime scheduled-job claims now expose persisted `job_type`, and `worker-runner` dispatches only `followup.send` and `sla.notify` to their real processors. Unknown job types become retryable durable job failures rather than being silently completed by the wrong processor.
- Implementation slice: `MessagingOutboxDispatcher` now maps `salesperson.sla_assignment_reminder` and `operator.sla_escalation` commands through the real Meta adapter path, preserving provider accepted/retryable/permanent/unknown classification and rejecting malformed payloads without provider calls.
- Decision: SLA enforcement uses semantic runtime jobs as the durable scheduling authority; due jobs revalidate current state before requesting any external notification effect.
- Verification failure: First SLA lint run failed because new service calls passed exact-optional fields as explicit `undefined`. Resolution: optional correlation, causation, and actor fields are now included only when present.
- Verification failure: First focused SLA integration run failed because the processing query used `USING (client_id)` after the joined left side contained multiple `client_id` columns. Resolution: changed SLA processing joins to explicit `ON` clauses.
- Verification: `npm run lint` passed after the optional-field fix.
- Verification: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts` passed after the explicit-join fix; focused tests ran 55 tests covering SLA scheduling, cancellation, execution, expired leases, and dispatcher mapping.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 88 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `0b8dd82`: Added durable SLA scheduling and execution.
- Implementation slice: Completed locally implementable MP-10 reporting with migration `019_reporting_jobs.sql` and `ReportingService`. Daily reports now persist semantic `app.daily_reports` linked to `runtime.scheduled_jobs`, schedule idempotently per client/date with explicit timezone, support cancellation/supersession, recover expired leases, generate SQL-backed summaries for intake/qualification/assignments/SLA/follow-ups/messages/dead letters, and enqueue one durable `operator.daily_report` outbox command without external calls inside transactions.
- Implementation slice: `worker-runner` now dispatches `report.daily` scheduled jobs to the reporting service, and `MessagingOutboxDispatcher` maps `operator.daily_report` through the Meta adapter path without hardcoded provider success.
- Decision: Daily reports are generated from authoritative PostgreSQL tables at job execution time instead of maintaining a second reporting state authority.
- Verification failure: First focused reporting run failed because the unacknowledged-assignment report count referenced `$2` while leaving `$1` and `$3` unused. Resolution: the count now computes active unacknowledged assignments as of the report date, explicitly using date and timezone parameters.
- Verification: `npm run lint` passed before and after the report query fix.
- Verification: `npx vitest run tests/messaging-outbox-dispatcher.test.ts tests/runtime.integration.test.ts` passed after the report query fix; focused tests ran 59 tests covering report scheduling, cancellation, expired leases, SQL count accuracy, and report dispatch mapping.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 9 files and 92 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live report recipient/template verification remains pending owner-provided recipient/template decisions and Meta staging verification.
- Commit `18a33a6`: Added durable daily reporting jobs.
- Implementation slice: Began MP-11 with migration `020_appointment_scheduling.sql`, `AppointmentService`, calendar provider interfaces, disabled-by-default `GoogleCalendarAdapter`, and `CalendarOutboxDispatcher`. Appointment offers and slots now use semantic identities, booking uses PostgreSQL locks and idempotency keys, duplicate replies return the original appointment/outbox IDs, and booked appointments enqueue durable `calendar.create_event` commands after local state is committed to the transaction.
- Decision: Appointment booking state precedes calendar side effects; Google Calendar dispatch is disabled unless real credentials are configured and never returns hardcoded success.
- Verification: `npm run lint` passed after the appointment/calendar foundation.
- Verification: `npx vitest run tests/calendar-outbox-dispatcher.test.ts tests/runtime.integration.test.ts` passed; focused tests ran 57 tests covering offer idempotency, cancellation, concurrent booking, duplicate reply replay, calendar command mapping, retry hints, malformed payload rejection, and missing Google credential rejection.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 10 files and 99 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live Google Calendar availability/create-event verification remains pending owner-provided credentials and calendar IDs.
- Commit `90c52ba`: Added appointment scheduling foundation.
- Implementation slice: Continued MP-11 with Google Calendar free/busy support and `calendar.create_event` pre-create availability recheck. The dispatcher checks provider availability before event creation, treats busy slots as definite rejections without calling create, preserves retry hints from availability and create failures, and continues to avoid hardcoded provider success.
- Decision: Calendar dispatch rechecks provider availability immediately before create while keeping external HTTP outside booking transactions.
- Verification: `npm run lint` and `npx vitest run tests/calendar-outbox-dispatcher.test.ts` passed; focused calendar tests ran 6 tests covering availability available/busy/retryable paths, create retry hints, malformed payload rejection, and missing credential rejection.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 10 files and 101 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live Google Calendar free/busy and create-event verification remains pending owner-provided credentials and calendar IDs.
- Commit `4425613`: Added calendar availability recheck.
- Implementation slice: Continued MP-11 calendar delivery reconciliation. Runtime outbox delivery now persists provider calendar event IDs back to linked `app.appointments` rows and confirms the appointment. Delivery-unknown calendar create commands remain in durable `delivery_unknown` state, are not claimed for automatic replay, preserve the original payload/attempt history, and leave appointments booked without a provider event ID until operator reconciliation.
- Decision: Calendar create delivery state is part of appointment authority; ambiguous provider acceptance must be reconciled explicitly instead of blindly issuing another create request.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "appointment|delivery-unknown|concurrent slot"` passed; focused PostgreSQL tests ran 4 tests covering appointment booking, provider event ID persistence, and delivery-unknown replay safety.
- Verification: `npx vitest run tests/calendar-outbox-dispatcher.test.ts tests/runtime.integration.test.ts` passed; focused dispatcher/runtime tests ran 60 tests.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 10 files and 102 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `284b110`: Persisted calendar delivery outcomes.
- Implementation slice: Completed locally implementable MP-11 calendar reconciliation with `CalendarReconciliationService` and `npm run calendar:reconcile`. Operators can list ambiguous `delivery_unknown` calendar creates, confirm a verified provider event ID into `runtime.outbox_commands` and `app.appointments`, or mark the create permanently failed with dead-letter and audit evidence. Reconciliation is idempotent and does not call Google.
- Decision: A verified failed calendar create does not release the customer booking; it marks only the outbox side effect permanently failed while leaving the appointment booked for operator follow-up.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "appointment|delivery-unknown|calendar create"` passed; focused PostgreSQL tests ran 6 tests covering delivery-unknown preservation, confirmed reconciliation, failed reconciliation, idempotent replay, audit recording, and dead-letter capture.
- Verification: `npx vitest run tests/calendar-outbox-dispatcher.test.ts tests/runtime.integration.test.ts` passed; focused dispatcher/runtime tests ran 62 tests.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 10 files and 104 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: live Google Calendar availability/create/delete/duplicate-booking verification remains pending owner-provided credentials and calendar IDs.
- Commit `fec6c33`: Added calendar create reconciliation command.
- Implementation slice: Began MP-12 direct ingress controls by adding explicit `DIRECT_META_WEBHOOK_ENABLED` and `DIRECT_LEAD_INGRESS_ENABLED` flags. Direct Meta challenge/receipt and direct website/Facebook lead ingress now return 503 unless explicitly enabled, while n8n compatibility remains independently gated.
- Decision: Direct provider ingress requires explicit environment enablement separate from the presence of secrets and separate from n8n compatibility fallback.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed; focused app-injection tests ran 2 tests proving disabled direct routes and separately enabled n8n compatibility.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 11 files and 106 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `8738391`: Gated direct ingress routes for cutover.
- Implementation slice: Continued MP-12 with `CutoverReadinessService` and `npm run cutover:readiness`. The report reads current direct-ingress flags, n8n fallback flag, pending/oldest inbox and outbox work, delivery-unknown counts, unreplayed dead letters, and latest runtime worker heartbeat age.
- Decision: Cutover readiness reporting is strictly read-only and does not claim, retry, replay, dead-letter, or mutate durable runtime rows.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness"` passed; focused PostgreSQL tests ran 2 tests covering clean readiness and stale queue/dead-letter failure checks.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 11 files and 108 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `16c0ac5`: Added cutover readiness report.
- Implementation slice: Added `docs/transition/DIRECT_INGRESS_PLAN.md` documenting local route contracts, explicit direct-ingress flags, staging route sequence, production canary route sequence, rollback, and decommission hold.
- Commit `de20db4`: Added direct ingress route plan.
- Implementation slice: Hardened `scripts/verify-deployment.sh` for MP-12 staging checks. The script accepts `--env-file`, `--base-url`, `--skip-ready`, `--skip-shadow`, `--check-direct-meta`, `--check-direct-lead`, and explicit expected direct-ingress modes. It verifies disabled direct routes as 503 and enabled Meta challenge echo without printing secrets. Its initial direct-lead enabled probe accepted non-5xx route reachability; DEC-026 later superseded that with explicit website/Facebook validation probes, and DEC-039 superseded the route contract again with durable-receipt acknowledgement and worker-owned validation.
- Decision: Deployment verification uses synthetic direct-ingress checks only; it does not mutate DNS, Caddy, provider accounts, n8n, Typebot, or production data.
- Verification: `bash -n scripts/verify-deployment.sh` passed.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed; focused tests ran 3 tests including deployment-script verification against a local app listener.
- Verification: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=moderate && npm run test:smoke` passed; Vitest ran 11 files and 109 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `f7f995d`: Hardened deployment verification for direct ingress.
- Implementation slice: Completed locally implementable MP-12 decommission readiness reporting with `DecommissionReadinessService` and `npm run decommission:readiness`. The report reads PostgreSQL state for legacy edge outbox work, n8n scheduled authority and inbox usage, recent/active legacy-owned conversations, direct-ingress stability evidence, active versioned configuration, completed Edge qualification volume, Airtable projection outbox stability, Airtable reconciliation state, final export flags, migration flags, and explicit owner approvals.
- Decision: Decommission readiness is read-only and approval-gated; it does not delete, disable, replay, retry, or mutate legacy systems or durable runtime rows.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed; focused PostgreSQL tests ran 2 tests covering blocker reporting for legacy/n8n/missing approvals and a passing report only with local exit evidence plus explicit approval flags.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, and `npm run test:smoke` passed; Vitest ran 11 files and 111 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Deferred external verification: decommission approval remains pending final legacy export, final Airtable export, live/staging cutover evidence, and explicit owner approval for n8n, Typebot, and Airtable retirement.
- Commit `73f5d96`: Added decommission readiness report.
- Commit `d761c47`: Recorded MP12 decommission readiness state.
- Verification failure: `docker info` still cannot connect to `unix:///var/run/docker.sock`, so Docker-based PostgreSQL dump metadata inspection and restore tests remain blocked by local daemon availability. Resolution: leave MP-02 Docker/dump verification recorded as pending; no evidence archive files were modified.
- Implementation slice: Completed the locally implementable MP-03 Events import gap. `scripts/import-airtable.ts` now imports verified Airtable `Events` fields into append-only `audit.events` rows with migration actor metadata, source event identity, optional client/lead linkage, secret-like payload redaction, idempotent same-hash reruns, and reject capture for unresolved linked client/lead records or invalid payload JSON.
- Implementation slice: Tightened Airtable reconciliation mapped-count checks so they compare the selected import run's raw records against matching entity-map rows, instead of counting all historical mappings across runs. Reconciliation now includes `events_mapped`.
- Decision: Historical Airtable events are audit evidence, not mutable business state; changed source events append a new audit row and update the entity map rather than mutating prior audit rows.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts` passed; focused importer tests ran 5 tests covering dry-run Events presence, idempotent Events import, audit payload redaction, events reconciliation, missing relationship rejection, and transaction rollback.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, and `npm run test:smoke` passed; Vitest ran 11 files and 111 tests, audit found 0 vulnerabilities, and smoke returned `ok=true`.
- Commit `75e4c1b`: Imported Airtable events into audit log.
- Implementation slice: Hardened deployment environment and worker readiness. `.env.example` now covers every validated runtime variable, including direct-ingress, n8n compatibility, runtime worker, Meta webhook/status/template, and Google Calendar flags. `scripts/generate-env.sh` now rotates the actual `.env.example` placeholders for database and service secrets. Compose now defines `lead-core-runtime-worker` with `WORKER_KIND=runtime` alongside the legacy `lead-core-worker` with `WORKER_KIND=outbox`.
- Implementation slice: `/ready` now checks fresh heartbeats for every enabled worker kind independently; `OUTBOX_WORKER_ENABLED=true` requires an `outbox` heartbeat and `RUNTIME_WORKER_ENABLED=true` requires a `runtime` heartbeat.
- Decision: Runtime worker deployment is first-class but still disabled by configuration until cutover; Compose can run the process to emit heartbeat evidence without claiming work unless `RUNTIME_WORKER_ENABLED=true`.
- Verification failure: Initial focused readiness test failed because the test assigned the unresolved `buildApp()` promise to `app`. Resolution: await `buildApp()` in the test setup.
- Verification failure: Initial static Compose check used `docker compose`, but this environment exposes the legacy `docker-compose` command. Resolution: reran with `docker-compose -f docker-compose.yml config`.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/env-contract.test.ts tests/health-readiness.integration.test.ts` passed; focused tests ran 2 tests covering env-template/schema alignment and `/ready` failing/passing on required runtime heartbeat state.
- Verification: `EDGE_POSTGRES_PASSWORD=dummy LEAD_CORE_ENV_FILE=/dev/null docker-compose -f docker-compose.yml config` passed and rendered `lead-core-runtime-worker` with `WORKER_KIND=runtime`.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 13 files and 113 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `b8114c6`: Hardened deployment env and worker readiness.
- Implementation slice: Disabled the legacy synchronous `/v1/turn` active-turn compatibility route by default behind `ACTIVE_TURN_COMPAT_ENABLED=false`, added the flag to the validated environment contract/template, and documented that direct Meta ingress must use the durable inbox path unless legacy compatibility is deliberately enabled.
- Decision: Legacy active-turn compatibility remains available only as an explicit rollback/compatibility switch because it predates the durable outbox path and sends through the old synchronous Meta path.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/env-contract.test.ts tests/ingress-gating.test.ts` passed; focused tests ran 4 tests covering env-template/schema alignment, direct ingress gates, n8n compatibility separation, deployment-script disabled route probes, and disabled `/v1/turn` behavior.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 13 files and 113 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `de1d36b`: Gated legacy active turn compatibility.
- Implementation slice: Added migration `021_legacy_edge_outbox_dead_letter.sql` and bounded the legacy `edge_outbox` compatibility worker to mark rows `dead_lettered` after five attempts instead of retrying forever. Decommission readiness now treats `dead_lettered` legacy outbox rows as unresolved compatibility work.
- Decision: Legacy `edge_outbox` remains a rollback/compatibility path, but it must still have a terminal failure state so failed compatibility delivery cannot run indefinitely.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "legacy edge outbox"` passed; focused PostgreSQL test ran 1 test proving migration-backed `dead_lettered` status, no further claim after terminal failure, and preserved last error/completion evidence.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "outbox"` passed before final commit; focused PostgreSQL tests ran 6 tests covering runtime outbox and legacy outbox behavior.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed after commit `4b04128`; Vitest ran 13 files and 114 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `4b04128`: Bounded legacy edge outbox retries.
- Implementation slice: Surfaced `ACTIVE_TURN_COMPAT_ENABLED` in cutover and decommission evidence. `npm run cutover:readiness` now includes `activeTurnCompatEnabled` and fails `active_turn_compatibility_disabled` when the legacy synchronous route is enabled. `npm run decommission:readiness` includes `active_turn_compat_disabled` before n8n/Typebot fallback can be considered removable.
- Decision: Legacy active-turn compatibility remains a rollback switch, but cutover and decommission reports must make it operator-visible and prevent accidental promotion/removal while enabled.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness|decommission"` passed; focused PostgreSQL tests ran 4 tests covering cutover readiness and decommission readiness outputs.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 13 files and 114 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `1cbdd30`: Surfaced active turn compatibility in readiness reports.
- Implementation slice: Added PostgreSQL 16 dump operations wrappers. `npm run dump:inspect` now allows overriding the Docker image through `POSTGRES_DOCKER_IMAGE`, and `npm run dump:restore-smoke` mounts the dump directory read-only, restores into an ephemeral container-local PostgreSQL instance, and reports schema/table counts plus configured important table row counts.
- Implementation slice: Added `tests/shell-scripts.test.ts` so operator shell scripts are parsed by `bash -n` during `npm test`.
- Verification failure: `docker info`, `DUMP_PATH=/Users/yassinkhalil/Downloads/automation-20260729-220630/public/databases/conversation-edge-postgres.dump npm run dump:inspect`, and `DUMP_PATH=/Users/yassinkhalil/Downloads/automation-20260729-220630/public/databases/conversation-edge-postgres.dump npm run dump:restore-smoke` failed because the Docker daemon socket `unix:///var/run/docker.sock` is unavailable. The evidence dump remained read-only.
- Verification: `npm run lint` and `npx vitest run tests/shell-scripts.test.ts` passed after dump tooling implementation.
- Verification: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 14 files and 115 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `91a8b5c`: Added PostgreSQL dump restore smoke tooling.
- Implementation slice: Added `npm run artifacts:scan` backed by `scripts/ops/scan-tracked-artifacts.sh` to fail if ignored runtime directories, dump/archive files, credential-like JSON, resolved Compose output, imports, exports, or local env files are tracked. `.env.example` is explicitly allowed.
- Verification failure: Initial `npm run artifacts:scan` flagged the intentional tracked `.env.example`. Resolution: added an explicit `.env.example` allow-list while keeping `.env` and `.env.*` blocked.
- Verification: `npm run artifacts:scan` passed after the allow-list fix and printed `tracked_artifact_scan=pass`.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed; the parser test now includes the artifact scan script.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 14 files and 115 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3ea0f22`: Added tracked artifact scan.
- Commit `9c67bea`: Recorded tracked artifact scan state.
- Verification: Final local handoff gate from commit `9c67bea` passed: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration`. Vitest ran 14 files and 115 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Deferred external verification: Remaining work is blocked on owner/external inputs only: real Airtable export, Docker daemon for dump inspection/restore-smoke execution, rotated Meta/staging route access, website/Facebook source configuration, Google Calendar credentials/calendar IDs, production cutover approval, and destructive legacy retirement approval.
- Commit `d1db5b1`: Recorded final local handoff gate.
- Verification failure: A full-gate rerun at `d1db5b1` passed `npm ci`, artifact scan, lint, Vitest, and build, then `npm audit --audit-level=moderate` failed because the npm registry audit endpoint returned an error. Resolution: reran `npm audit --audit-level=moderate` directly and it passed with 0 vulnerabilities, then reran `npm run test:smoke` and `npm run test:integration`, both of which passed.
- Implementation slice: Hardened MP-12 deployment verification so `scripts/verify-deployment.sh --check-direct-lead --expect-direct-lead=enabled` posted deliberately invalid website and Facebook lead validation probes and required `invalid_lead_payload`, instead of accepting any non-5xx response from complete synthetic lead payloads. This route contract was later superseded by DEC-039, which requires durable receipt acknowledgement and worker-owned validation.
- Decision: Enabled direct-lead deployment checks should prove both website and Facebook routes are enabled and reach validation without creating authoritative lead/contact state or outbound commands; ignored inbox receipts are acceptable staging evidence because direct ingress durably receipts before validation.
- Verification failure: Initial TypeScript lint failed because the new test parsed `seenBodies[0]` without proving it existed. Resolution: destructured and explicitly checked the captured body before parsing.
- Verification: `bash -n scripts/verify-deployment.sh`, `npx vitest run tests/ingress-gating.test.ts`, and `npm run lint` passed; focused route-gating tests now run 4 tests, including enabled website and Facebook direct-lead validation probe coverage.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 14 files and 116 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `c07ac06`: Hardened direct lead deployment probe for the website route.
- Commit `a399fa3`: Extended direct lead deployment probing to the Facebook route.
- Implementation slice: Hardened request logging so Fastify/Pino request serializers redact sensitive query parameters, including Meta `hub.verify_token`, plus internal/provider authentication headers before logs are emitted.
- Decision: Request logs should retain route/status observability while never printing reusable webhook verification tokens, signatures, or internal shared secrets.
- Verification failure: Initial logger redaction test imported the logger singleton before required environment variables existed, and TypeScript flagged the raw Pino request serializer cast. Resolution: moved pure redaction helpers and the request serializer into `src/config/log-redaction.ts`, imported the serializer from `src/config/logger.ts`, and tested the serializer without constructing the logger singleton.
- Verification: `npx vitest run tests/logger.test.ts` passed with 3 tests covering URL redaction, header redaction, and the configured request serializer shape; `npm run lint` passed.
- Verification failure: The first full npm gate after logger hardening showed that Fastify/Pino also serializes `req.query`, which still exposed the test `hub.verify_token`; `req.url` was also over-redacted by the generic Pino redaction path. Resolution: added query-object redaction to the request serializer and removed the broad `req.url` redaction path so route evidence remains visible with only sensitive query values censored.
- Verification failure: The first serializer test for `req.query` used a mock without Fastify's parsed query object, so Pino returned an empty string for `query`. Resolution: made query redaction tolerate non-object serializer values and updated the serializer test to include the parsed query object shape.
- Verification: `npx vitest run tests/logger.test.ts` passed with 4 tests; `npm run lint` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 15 files and 120 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`. Request logs emitted during the run showed Meta `hub.verify_token` and internal/provider authentication headers redacted while preserving route paths.
- Commit `e7bc966`: Redacted webhook secrets from request logs.
- Implementation slice: Hardened `scripts/verify-deployment.sh` so sourced environment values remain shell-local, `EDGE_SHARED_SECRET` is written to a private temporary curl header file and passed with `--header @file`, and `META_WEBHOOK_VERIFY_TOKEN` is placed in a private temporary curl config file for the Meta challenge URL.
- Decision: Deployment verification should avoid printing secrets and avoid exposing them through argv/process listings or child-process environments; temporary header/config files are removed by the existing cleanup trap.
- Verification: `bash -n scripts/verify-deployment.sh`, `npx vitest run tests/ingress-gating.test.ts`, and `npm run lint` passed; focused ingress-gating tests ran 5 tests including static coverage that the verifier no longer exports sourced env values, no longer embeds `EDGE_SHARED_SECRET` in curl header arguments, and no longer sends the Meta verify token through the curl URL command argument.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 15 files and 121 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3588ff5`: Kept verifier secrets out of curl arguments.
- Commit `5f78182`: Kept Meta verify token out of curl arguments and child-process environments.
- Implementation slice: Hardened `scripts/shadow-sequence.sh` so it keeps sourced environment values shell-local and passes `EDGE_SHARED_SECRET` to curl through a private temporary header file instead of a command-line header argument.
- Implementation slice: Hardened backup, restore, and restore-verification scripts so password-bearing PostgreSQL URLs are converted into private temporary libpq service files, original URL variables are unset, and `pg_dump`, `psql`, and `pg_restore` receive only non-secret service names.
- Decision: Operator scripts should not expose reusable shared secrets or database passwords through argv or child-process environments when private temporary files can preserve the same behavior.
- Verification failure: Initial static backup/restore test rejected the safe shell variable assignment used before unsetting the URL. Resolution: narrowed the static assertions to unsafe PostgreSQL tool invocations that pass raw URL variables directly to child process arguments.
- Verification: `bash -n scripts/shadow-sequence.sh && bash -n scripts/backup/backup-postgres.sh && bash -n scripts/backup/restore-postgres.sh && bash -n scripts/backup/verify-restore.sh`, a no-bytecode Python `compile(...)` check for `scripts/backup/write-pg-service.py`, `npx vitest run tests/shell-scripts.test.ts`, and `npm run lint` passed; focused shell tests ran 4 tests covering syntax, shadow secret header handling, libpq service-file generation, and absence of raw URL arguments in PostgreSQL tool calls.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 15 files and 124 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `d57f153`: Kept operator script secrets out of process arguments.
- Verification failure: `docker info` still failed to connect to `unix:///var/run/docker.sock`; Docker-backed PostgreSQL dump inspection and restore-smoke execution remain blocked by local daemon availability.
- Implementation slice: Hardened the Google Calendar adapter so free/busy network exceptions return retryable outcomes, while create-event network exceptions return `delivery_unknown` outcomes for operator reconciliation instead of falling through as generic runtime exceptions.
- Decision: Network errors before an external calendar mutation can be retried, but network errors during create may occur after provider acceptance and must preserve ambiguity to avoid duplicate calendar events.
- Verification: `npx vitest run tests/calendar-outbox-dispatcher.test.ts` passed with 8 tests covering dispatcher mapping plus Google adapter network-error classification; `npm run lint` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 15 files and 126 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `89bc46e`: Classified Google Calendar network failures.
- Implementation slice: Hardened Google Calendar retry-hint parsing so numeric and HTTP-date `Retry-After` headers are supported and capped at one hour before being passed to durable outbox retry scheduling.
- Verification: `npx vitest run tests/calendar-outbox-dispatcher.test.ts` passed with 10 tests covering dispatcher mapping, network-error classification, and bounded numeric/date Google retry hints; `npm run lint` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 15 files and 128 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3cba1c3`: Bounded Google Calendar retry hints.
- Implementation slice: Hardened `scripts/generate-env.sh` so generated local database and service secrets are written to private temporary files, unset from shell variables, and read by Python from file paths instead of secret-bearing process arguments.
- Decision: Generated `.env` credentials are treated as reusable secrets and must not be passed through child-process arguments during local setup.
- Verification: `bash -n scripts/generate-env.sh` passed.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 6 tests covering script syntax, shadow secret handling, generated-env secret handling, generated `.env` rendering, libpq service-file generation, and PostgreSQL tool argument hygiene.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 15 files and 130 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `ddf9714`: Kept generated env secrets out of process arguments.
- Implementation slice: Replaced deterministic runtime retry spacing with bounded exponential backoff plus random jitter for inbox, outbox, and scheduled-job retries when no provider retry hint is supplied. Provider retry hints remain honored exactly with the existing one-hour cap.
- Decision: Runtime retries should include jitter so provider or worker recovery does not cause synchronized retry bursts.
- Verification failure: The first focused `tests/runtime-backoff.test.ts` run failed before tests executed because importing `src/infrastructure/runtime.ts` initializes the DB pool and requires environment variables. Resolution: set dummy local env values before dynamically importing the runtime helper in the test harness.
- Verification: `npx vitest run tests/runtime-backoff.test.ts` passed with 3 tests covering jittered ranges, provider hint cap behavior, and extreme attempt bounds.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "retry delays|retryable inbox|outbox retry"` passed with 2 PostgreSQL tests and 59 skipped by filter, covering retryable inbox scheduling and outbox retry/dead-letter behavior.
- Verification: `npm run lint` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 133 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `5268c98`: Added jitter to runtime retry backoff.
- Implementation slice: Hardened environment validation so enabled external integration modes require their operational credentials at startup. Legacy outbox now requires target URL and secret, direct Meta webhook requires verify token and app secret, direct Meta send requires access token and phone ID, active-turn compatibility requires direct Meta send, and Google Calendar dispatch requires an access token.
- Decision: Disabled integrations remain credential-free for cutover and local development, but enabled integrations should fail startup validation before receiving traffic if required credentials are absent.
- Verification: `npx vitest run tests/env-contract.test.ts` passed with 6 tests covering env-template alignment, disabled integration blanks, legacy outbox requirements, direct Meta webhook requirements, direct Meta send/active-turn compatibility requirements, and Google Calendar requirements.
- Verification: `npm run lint` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 138 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `b9927f3`: Required credentials for enabled integrations.
- Implementation slice: Added a permanent scheduled-job `dead_lettered` processing outcome, wired it through `RuntimeWorker` and `JobRepository.deadLetter`, changed malformed follow-up job payloads and unsupported scheduled-job types to dead-letter instead of retrying, and preserved scheduled-job attempt/dead-letter evidence.
- Decision: Invalid scheduled-job payloads are permanent local defects and should become operator-visible dead letters immediately rather than consuming retry attempts.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "dead-letters malformed follow-up jobs|retry delays|retryable inbox|outbox retry"` passed with 3 PostgreSQL tests and 59 skipped by filter, covering immediate malformed follow-up job dead-lettering plus existing retry paths.
- Verification: `npm run lint` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 139 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3bde28a`: Dead-lettered invalid scheduled jobs immediately.

## 2026-08-01 Recurring Daily Report Materialization

- Implementation slice: Hardened MP-10 daily reporting recurrence so successful `report.daily` execution now marks the current report sent, enqueues the durable `operator.daily_report` outbox command, and schedules exactly the next semantic daily report/job in the same PostgreSQL transaction. The next occurrence preserves the client-local report clock time in the configured timezone, including daylight-saving UTC offset changes.
- Decision: Added DEC-035. Recurrence metadata is not treated as a durable scheduling authority by itself; workers materialize one next occurrence at completion using semantic job identity for idempotency.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "daily report"` passed with 4 PostgreSQL daily-report tests and 59 skipped by filter, including the Europe/Berlin DST materialization case.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 140 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `7bc8748`: Materialized recurring daily report jobs.

## 2026-08-01 Decommission Direct-Ingress Stability Evidence

- Implementation slice: Tightened MP-12 decommission readiness so direct-ingress stability requires aged processed direct inbox events. Ignored direct-ingress deployment probes remain route-check evidence but no longer count toward fallback-removal stability.
- Decision: Added DEC-036. Synthetic invalid route probes cannot satisfy decommission readiness for legacy fallback removal.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 3 PostgreSQL decommission-readiness tests and 61 skipped by filter, including the ignored-probe regression case.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 141 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `2fb9221`: Required processed direct ingress for decommission stability.

## 2026-08-01 Cutover Scheduled-Job Backlog

- Implementation slice: Hardened MP-12 cutover readiness so the read-only report includes due or processing `runtime.scheduled_jobs` as backlog alongside inbox and outbox work. Future scheduled jobs remain allowed and do not count against the pending scheduled-job threshold.
- Decision: Added DEC-037. Scheduled jobs are durable runtime authority and must be visible in route-cutover readiness without blocking on legitimate future work.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness"` passed with 2 PostgreSQL cutover-readiness tests and 62 skipped by filter, including due scheduled-job backlog failure while a future scheduled job was ignored.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 141 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `d931368`: Included scheduled jobs in cutover readiness.

## 2026-08-01 Operational Worker Heartbeat Readiness

- Implementation slice: Hardened `/ready` and MP-12 cutover readiness to require operational heartbeat metadata for required workers. Runtime worker readiness now requires a fresh heartbeat with `enabled=true` and at least one configured handler; legacy outbox readiness requires the heartbeat metadata to show the worker enabled and target configured.
- Decision: Added DEC-038. Fresh heartbeat timestamps alone are insufficient because disabled worker processes can intentionally heartbeat without claiming durable work.
- Verification: `npm run lint` passed.
- Verification failure: First focused readiness run failed because the runtime integration test imported readiness modules with `RUNTIME_WORKER_ENABLED=false`, making the disabled heartbeat a warning by design. Resolution: set `RUNTIME_WORKER_ENABLED=true` in the runtime integration environment before import.
- Verification: `npx vitest run tests/health-readiness.integration.test.ts tests/runtime.integration.test.ts -t "readiness"` passed with 5 PostgreSQL readiness tests and 61 skipped by filter, covering `/ready` and cutover readiness disabled-heartbeat rejection.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 142 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `25c0dfc`: Required operational worker heartbeats for readiness.

## 2026-08-01 Direct Lead Inbox Processing

- Implementation slice: Moved direct website/Facebook lead webhook business processing out of the HTTP request path. The routes now authenticate, gate, durably receipt, deduplicate, and acknowledge; `LeadIngressInboxProcessor` validates and processes lead receipts through `LeadIntakeService` from the runtime worker.
- Implementation slice: Added provider/event-type filters to `InboxRepository.claim` and `RuntimeWorker` so specialized inbox processors claim only the inbox events they are configured to process. Runtime worker heartbeat metadata now advertises configured inbox providers and event types.
- Implementation slice: Hardened MP-12 cutover readiness so direct Meta and direct lead ingress require matching runtime inbox processor metadata when their direct route flags are enabled.
- Decision: Added DEC-039. Direct lead webhooks acknowledge durable receipt only; validation, permanent ignores, retryable failures, and lead-intake business state belong to the runtime worker.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/ingress-gating.test.ts tests/runtime.integration.test.ts -t "configured inbox event types|direct lead|website lead|Facebook lead|cutover readiness|durably records invalid"` passed with 10 tests and 63 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 145 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `9cc10e1`: Processed direct lead ingress through runtime inbox.

## 2026-08-01 Direct Ingress Runtime Worker Contract

- Implementation slice: Hardened startup validation so direct website/Facebook lead ingress cannot be enabled unless `RUNTIME_WORKER_ENABLED=true`, and direct Meta webhook ingress cannot be enabled unless both `RUNTIME_WORKER_ENABLED=true` and `META_STATUS_PROCESSOR_ENABLED=true`.
- Decision: Added DEC-040. Direct route flags must be coupled to the durable runtime worker path that processes their inbox receipts; `/ready` still verifies fresh operational heartbeat evidence after startup.
- Documentation: Updated deployment, API, direct-ingress plan, cutover runbook, staging owner action, status, and work queue docs to show the required route/worker flag pairings.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/env-contract.test.ts tests/ingress-gating.test.ts tests/health-readiness.integration.test.ts tests/runtime.integration.test.ts -t "environment contract|direct ingress|readiness|cutover readiness"` passed with 18 tests and 63 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 146 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `a0c61a5`: Required runtime worker for direct ingress flags.

## 2026-08-01 Monotonic WhatsApp Delivery Status

- Implementation slice: Hardened Meta/n8n WhatsApp delivery-status processing so every distinct provider status event is still persisted, while `app.messages.state` only advances by lifecycle precedence and cannot regress when older provider webhooks arrive later.
- Decision: Added DEC-041. Provider webhook arrival order is not authoritative for current message delivery state; the event trail remains authoritative evidence for reconciliation.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "delivery state|Meta status"` passed with 2 PostgreSQL tests and 67 skipped by filter, covering duplicate durable Meta status receipt plus the out-of-order `read` then `sent` regression case.
- Verification: `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 147 tests, audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Verification: `npm ci` and `npm run artifacts:scan` passed; `npm ci` installed 118 packages with 0 vulnerabilities and tracked artifact scan passed.
- Commit `a5f11a8`: Kept message delivery status monotonic.

## 2026-08-01 Decommission Business-Ingress Stability

- Implementation slice: Tightened MP-12 decommission readiness so direct-ingress stability counts only processed direct business ingress events: Meta inbound messages and website/Facebook lead receipts. Direct provider status callbacks no longer satisfy fallback-removal stability evidence.
- Decision: Added DEC-042. Delivery/status callbacks prove provider reporting but not Edge-owned customer/lead ingress stability.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 4 PostgreSQL decommission-readiness tests and 66 skipped by filter, including the status-callback regression case.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 148 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3b47a51`: Counted only business ingress for decommission stability.

## 2026-08-01 API Startup Configuration Authority

- Implementation slice: Removed `npm run seed:prod` from the production API container startup command. `lead-core-api` now starts with `npm start`; migrations, seeding, and configuration publication remain explicit operations outside normal API startup.
- Decision: Added DEC-043. API startup must not mutate configuration authority or PostgreSQL state as a side effect.
- Verification: `npx vitest run tests/shell-scripts.test.ts -t "API container startup|shell scripts"` passed with 7 tests, including the Compose command regression check.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 149 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Verification: `EDGE_POSTGRES_PASSWORD=dummy LEAD_CORE_ENV_FILE=/dev/null docker-compose -f docker-compose.yml config` passed.
- Commit `73c61e3`: Removed API startup configuration seed.

## 2026-08-01 Runtime-Only Production Build Output

- Implementation slice: Added `tsconfig.build.json`, changed `npm run build` to clean `dist` and compile only `src` plus `scripts`, and removed `COPY tests ./tests` from the Docker build stage. `npm run lint` continues to typecheck tests through the main `tsconfig.json`.
- Decision: Added DEC-044. Production artifacts and images should contain runtime code and operational scripts, not compiled tests.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 8 deployment/shell tests.
- Verification: `npm run build && test ! -d dist/tests` passed, proving the build output no longer contains compiled tests.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 150 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `78e1370`: Excluded tests from production build output.

## 2026-08-01 Unsupported Meta Webhook Ignore Processing

- Implementation slice: Hardened direct Meta webhook receipt so signed payloads without supported message/status events no longer remain permanently pending. `MetaInboxProcessor` now claims `whatsapp.webhook_ignored` receipts and marks them ignored with an operator-visible reason, and `worker-runner` heartbeat/claim metadata includes that event type.
- Implementation slice: Tightened MP-12 cutover readiness so direct Meta ingress requires worker metadata for `whatsapp.webhook_ignored` as well as message/status events.
- Decision: Added DEC-045. Unsupported signed provider payloads are durable receipts with worker-owned ignored outcomes, not unclaimable inbox backlog.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "unsupported signed Meta|Meta status|cutover readiness"` passed with 7 PostgreSQL/API tests and 65 skipped by filter, covering signed unsupported Meta receipt, worker ignore processing, and cutover readiness failure when ignored-webhook metadata is missing.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 152 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `b1786da`: Ignored unsupported Meta webhooks through runtime worker.

## 2026-08-01 N8n Callback Durable Receipt Before Relationship Resolution

- Implementation slice: Hardened n8n-compatible inbound callback routes for WhatsApp status acknowledgements, inbound WhatsApp messages, and salesperson commands so they authenticate, validate request shape, write `runtime.inbox_events`, and acknowledge durable receipt before resolving client relationships.
- Implementation slice: Preserved the submitted client identity fields in raw inbox payloads so runtime workers can produce durable missing-message, missing-channel, or missing-client outcomes without dropping unknown-client callbacks at the HTTP edge.
- Decision: Added DEC-046. n8n compatibility callbacks are external event ingress during cutover; worker processors own relationship failures after durable receipt. The n8n-compatible outbound send route still resolves client identity synchronously because it requests a new outbound effect.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "n8n-compatible"` passed with 4 PostgreSQL/API tests and 69 skipped by filter, covering n8n send/status/inbound compatibility and unknown-client status/inbound/command durable receipts with worker-owned retry/ignore/rejected outcomes.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 153 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `146ebf6`: Receipt n8n callbacks before relationship resolution.

## 2026-08-01 Readiness CLI Fail-Closed Argument Parsing

- Implementation slice: Hardened `npm run cutover:readiness` and `npm run decommission:readiness` wrappers so unknown arguments and malformed numeric thresholds fail before any PostgreSQL readiness query runs.
- Decision: Added DEC-047. Readiness command arguments fail closed because operator typo handling is part of promotion and decommission evidence integrity.
- Verification: `npx vitest run tests/shell-scripts.test.ts -t "readiness CLI"` passed with 2 focused CLI tests and 8 skipped by filter, covering unknown cutover/decommission flags and malformed numeric thresholds without touching PostgreSQL.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 155 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `25dc613`: Fail closed on readiness CLI arguments.

## 2026-08-01 Decommission Current Direct-Ingress Authority

- Implementation slice: Hardened `npm run decommission:readiness` so n8n fallback-removal readiness requires current direct-ingress authority: `RUNTIME_WORKER_ENABLED=true` plus at least one direct business ingress flag enabled. Historical processed direct-ingress events remain necessary but are no longer sufficient.
- Decision: Added DEC-048. Decommission readiness requires current direct-ingress authority because old durable rows prove past routing only.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 5 PostgreSQL tests and 69 skipped by filter, including the new disabled-current-direct-ingress regression case.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 156 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3c81394`: Require current direct ingress for decommission readiness.

## 2026-08-01 Decommission Direct-Ingress Worker Heartbeat Authority

- Implementation slice: Hardened `npm run decommission:readiness` so n8n fallback-removal readiness requires a fresh operational runtime worker heartbeat whose metadata includes the inbox providers and event types required by the currently enabled direct-ingress routes.
- Implementation slice: Added `--max-worker-heartbeat-age-seconds` to `npm run decommission:readiness` and included that threshold plus latest runtime worker heartbeat state in the JSON report.
- Test hardening: PostgreSQL integration setup now truncates `runtime.worker_heartbeats` between tests so readiness cases cannot pass from stale heartbeats created by earlier tests.
- Decision: Added DEC-049. Decommission requires operational direct-ingress worker metadata, not route flags alone.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 7 PostgreSQL tests and 69 skipped by filter, including no-heartbeat and missing-direct-lead-processor regressions.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 158 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `69bad40`: Require direct ingress worker heartbeat for decommission.

## 2026-08-01 Decommission Route-Family Stability Evidence

- Implementation slice: Hardened `npm run decommission:readiness` so direct-ingress stability must match each currently enabled direct-ingress route family. Enabled direct Meta ingress requires aged processed Meta inbound-message evidence; enabled direct lead ingress requires aged processed website or Facebook lead evidence.
- Implementation slice: Added direct Meta and direct lead stability counts to the decommission readiness metrics and `direct_ingress_stable` check details while preserving the aggregate direct-ingress stability count.
- Decision: Added DEC-050. Stability evidence from one ingress family does not prove another enabled route family has replaced legacy fallback authority.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 8 PostgreSQL tests and 69 skipped by filter, including a Meta-only stability regression while direct lead ingress is enabled.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 159 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3a62a8c`: Match decommission stability to direct ingress families.

## 2026-08-01 N8n Inbox Dead Letters Block Decommission

- Implementation slice: Hardened `npm run decommission:readiness` so `no_unresolved_n8n_inbox` counts n8n inbox events in `dead_lettered` state as unresolved compatibility work.
- Decision: Added DEC-051. N8n dead letters block decommission until replayed, ignored, or otherwise resolved by an operator-approved path.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 9 PostgreSQL tests and 69 skipped by filter, including an aged n8n dead-letter regression that does not rely on recent-usage blocking.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 160 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3ec9096`: Block decommission on n8n inbox dead letters.

## 2026-08-01 Signed Direct Meta Deployment Probe

- Implementation slice: Hardened `scripts/verify-deployment.sh --check-direct-meta --expect-direct-meta=enabled` so it verifies both Meta challenge handling and a signed non-customer webhook POST that should be durably receipted through the ignored-webhook path.
- Implementation slice: The verifier computes the Meta HMAC from private temporary files and sends the signed POST through a private curl config file so the app secret and signature are not placed in curl command arguments.
- Decision: Added DEC-052. Direct Meta deployment verification must prove signature handling and durable POST receipt, not only challenge URL reachability.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed with 6 route/deployment-script tests, including a local HTTP server that validates the verifier's HMAC header for the signed non-customer Meta probe.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 161 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `f5f4847`: Verify signed direct Meta deployment probes.

## 2026-08-01 Rejected N8n Salesperson Commands Block Decommission

- Implementation slice: Hardened `npm run decommission:readiness` so rejected n8n salesperson command outcomes block fallback removal even when the originating compatibility inbox event has already been processed.
- Decision: Added DEC-053. A processed inbox row proves durable receipt handling, but a rejected command row proves compatibility traffic failed business-authority validation and still needs operator reconciliation before n8n removal.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 10 PostgreSQL tests and 69 skipped by filter, including an aged processed n8n command inbox receipt plus a rejected `app.salesperson_commands` row that fails only the new rejected-command readiness check.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 162 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `5192fdb`: Block decommission on rejected n8n commands.

## 2026-08-01 Parked Legacy Edge Outbox Blocks Decommission

- Implementation slice: Hardened `npm run decommission:readiness` so legacy `edge_outbox.status='parked'` rows count as unresolved n8n compatibility work rather than appearing drained.
- Decision: Added DEC-054. Parked shadow-rollout rows are retained side-effect records that require operator-visible disposition before compatibility infrastructure retirement.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 11 PostgreSQL tests and 69 skipped by filter, including a parked legacy `edge_outbox` row that fails `legacy_edge_outbox_drained` while direct-ingress and legacy-conversation checks pass.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 163 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `486e7ee`: Block decommission on parked edge outbox.

## 2026-08-01 Cancelled Airtable Projection Commands Block Decommission

- Implementation slice: Hardened `npm run decommission:readiness` so cancelled `airtable.project_lead_visibility` durable outbox commands count as incomplete Airtable projection evidence.
- Decision: Added DEC-055. A cancelled projection command is terminal durable state, but it is not delivered projection evidence and must not be treated as Airtable-retirement readiness.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 12 PostgreSQL tests and 69 skipped by filter, including a cancelled Airtable projection command that fails `airtable_projection_outbox_stable` while owner flags and reconciliation evidence pass.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 164 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `6378f7d`: Block Airtable decommission on cancelled projections.

## 2026-08-01 N8n Delivery Status Decommission Classification

- Audit slice: Reviewed n8n-compatible delivery-status receipt, processing, and decommission readiness classification.
- Decision: Added DEC-056. Unresolved or recent n8n delivery-status inbox rows block n8n removal through existing checks, while older processed failed or unknown n8n delivery statuses remain delivery/reporting evidence and do not create an unbounded decommission blocker.
- Verification: No code change was required. This audit relies on the already-verified `no_unresolved_n8n_inbox`, `no_recent_n8n_compat_usage`, and direct-ingress stability behavior covered by the 2026-08-01 decommission readiness test runs.

## 2026-08-01 Direct Meta Unsigned Deployment Rejection

- Implementation slice: Hardened `scripts/verify-deployment.sh --check-direct-meta --expect-direct-meta=enabled` so staging verification proves direct Meta challenge handling, signed durable receipt, and unsigned webhook rejection.
- Implementation slice: The unsigned probe reuses the non-customer Meta payload and private curl config path, does not include a signature header, and expects HTTP 401 from the enabled direct Meta route.
- Decision: Added DEC-057. Staging route verification must prove both positive and negative Meta signature behavior before route changes are treated as verified.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed with 6 route/deployment-script tests, including the local verifier server observing both the signed accepted probe and unsigned rejected probe.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 164 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `985a49d`: Verify direct Meta unsigned rejection.

## 2026-08-01 Disabled Direct Meta POST Verification

- Implementation slice: Hardened `scripts/verify-deployment.sh --check-direct-meta --expect-direct-meta=disabled` so disabled direct Meta verification now checks both challenge and POST behavior.
- Implementation slice: The disabled POST probe uses the same non-customer Meta body and expects HTTP 503 before signature validation or durable receipt.
- Decision: Updated DEC-057. Direct Meta deployment verification now proves challenge and POST behavior for the expected route state, enabled or disabled.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed with 6 route/deployment-script tests, including disabled direct Meta GET and POST returning unavailable plus deployment verifier output for the disabled POST check.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 164 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `9f05998`: Verify disabled direct Meta POST.

## 2026-08-01 Staging Verifier Documentation Alignment

- Documentation slice: Aligned `scripts/verify-deployment.sh --help`, `docs/owner-actions/06-staging-dns-and-access.md`, and `docs/transition/RISKS.md` with the current direct Meta verifier contract.
- Documentation slice: Owner staging instructions now state that direct Meta verification covers challenge and POST behavior for both enabled and disabled route states, including signed durable receipt, unsigned rejection, and disabled POST unavailability.
- Verification: `bash -n scripts/verify-deployment.sh` passed.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed with 6 route/deployment-script tests.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 164 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `c7d6f87`: Align staging verifier documentation.

## 2026-08-01 Disabled Direct Ingress Verification Without Secrets

- Implementation slice: Hardened direct lead ingress route gating so disabled website/Facebook routes return HTTP 503 before `EDGE_SHARED_SECRET` validation, matching direct Meta disabled behavior and the documented unavailable route state.
- Implementation slice: Hardened `scripts/verify-deployment.sh` so disabled direct Meta checks can use a non-secret placeholder challenge token and disabled direct lead checks can run without `EDGE_SHARED_SECRET` when shadow verification is skipped; enabled checks still require the real credentials they verify.
- Decision: Added DEC-058. Disabled direct-ingress verification should not be blocked by missing rotated provider credentials or internal route secrets, while enabled verification still proves auth/signature behavior.
- Verification: First focused run of `npx vitest run tests/ingress-gating.test.ts` failed because an empty Bash array expansion under `set -u` broke disabled lead verification on macOS Bash; fixed by replacing the array with a conditional `lead_status_request` helper.
- Verification: `bash -n scripts/verify-deployment.sh` passed.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed with 6 route/deployment-script tests, including a child process with a minimal environment proving disabled direct-route verification does not inherit or require Meta/edge secrets.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 16 files and 164 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `158b802`: Allow disabled ingress verification without secrets.

## 2026-08-01 N8n Fallback Runtime Inbox Wiring

- Implementation slice: Added `buildRuntimeInboxWiring` and changed `worker-runner` so n8n-compatible WhatsApp status, inbound message, and salesperson command inbox events are claimed by the shared Meta/n8n inbox processor whenever `N8N_COMPAT_ROUTES_ENABLED=true`, independent of direct Meta webhook processing.
- Implementation slice: Kept website/Facebook lead processors gated by `DIRECT_LEAD_INGRESS_ENABLED=true` and preserved specialized runtime inbox claim filters by provider and event type.
- Decision: Added DEC-059. n8n fallback callback rows must remain processable while direct Meta webhook ingress is disabled during staging, rollback, or phased cutover.
- Verification: First focused run failed: `npm run lint` found `leadIngressInboxEventTypes` missing from `worker-runner`, and `tests/runtime-worker-wiring.test.ts` imported processor modules before test environment variables were set. Fixed the import and switched the test to dynamic imports after applying test env.
- Verification: `npm run lint` passed after the fix.
- Verification: `npx vitest run tests/runtime-worker-wiring.test.ts tests/runtime.integration.test.ts -t "runtime worker wiring|n8n-compatible|configured inbox event types|cutover readiness"` passed with 12 tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 166 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `838971b`: Wire n8n fallback inbox processing independently.

## 2026-08-01 N8n Compatibility Runtime Readiness Enforcement

- Implementation slice: Hardened startup validation so `N8N_COMPAT_ROUTES_ENABLED=true` requires `RUNTIME_WORKER_ENABLED=true`, matching the durable callback receipt architecture.
- Implementation slice: Hardened `npm run cutover:readiness` with `n8n_compatibility_inbox_processor`, which fails when enabled n8n compatibility lacks runtime heartbeat metadata for provider `n8n` and event types `whatsapp.message_status`, `whatsapp.message_received`, and `salesperson.command_received`.
- Decision: Added DEC-060. n8n compatibility routes are fallback infrastructure, but their callback routes are durable external event ingress and must not be accepted without a worker able to process their inbox rows.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/env-contract.test.ts tests/ingress-gating.test.ts tests/runtime-worker-wiring.test.ts tests/runtime.integration.test.ts -t "environment contract|direct ingress|runtime worker wiring|cutover readiness|n8n-compatible"` passed with 27 tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 168 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `06c8c7f`: Require runtime readiness for n8n compatibility.

## 2026-08-01 N8n Fallback Deployment Verification

- Implementation slice: Hardened `scripts/verify-deployment.sh` with `--check-n8n-compat` and `--expect-n8n-compat=<enabled|disabled>` so staging verification can prove n8n compatibility fallback availability or intentional unavailability through an authenticated, non-customer inbound-message probe.
- Implementation slice: The verifier writes `EDGE_INTERNAL_SECRET` to a private temporary curl header file, keeps sourced environment values shell-local, and expects durable `ok=true` acknowledgement when n8n compatibility is enabled or HTTP 503 after internal authentication when disabled.
- Documentation slice: Updated DEC-061, the direct ingress plan, staging owner actions, risk register, status, work queue, and next-action records with the n8n fallback verifier contract.
- Verification: `bash -n scripts/verify-deployment.sh` passed.
- Verification: `npx vitest run tests/ingress-gating.test.ts` passed with 8 tests, including enabled and disabled n8n fallback verifier child-process coverage plus static secret-argument checks.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 170 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `5e2101c`: Verify n8n fallback route availability.

## 2026-08-01 N8n Compatibility Routes Block Decommission

- Implementation slice: Hardened `npm run decommission:readiness` so n8n readiness fails while `N8N_COMPAT_ROUTES_ENABLED=true`, even when no recent/unresolved n8n inbox rows remain and direct-ingress stability plus runtime-worker checks pass.
- Implementation slice: Exported readiness CLI parser functions and changed the shell-script parser tests to import them directly after dummy env setup, preserving fail-closed argument validation without `npx tsx` startup timing as a test dependency.
- Decision: Added DEC-062. An enabled n8n compatibility route is still fallback ingress authority and must block n8n removal readiness.
- Documentation slice: Updated the decommission runbook, production cutover owner action, status, and work queue with `n8n_compatibility_routes_disabled`.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 12 PostgreSQL tests and 70 skipped by filter.
- Verification: First full gate failed in `tests/shell-scripts.test.ts` because two readiness CLI parser tests used `npx tsx` child processes and exceeded the 5000 ms test timeout before assertions completed. The test harness was fixed by directly importing exported parser functions.
- Verification: `npx vitest run tests/shell-scripts.test.ts`, `npm run lint`, and `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed after the parser test harness fix.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 170 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `0072a47`: Require n8n compatibility routes off for decommission.

## 2026-08-01 Airtable Reconciliation Readiness Hardening

- Implementation slice: Added MP-03 dry-run phone/email collision reporting for Airtable Leads and Salespeople source rows using normalized values and stable source record IDs.
- Implementation slice: Hardened `npm run reconcile:airtable` so rejected records fail reconciliation and accepted-row mapped checks record raw, rejected, and accepted counts instead of comparing mapped target rows to every raw source row.
- Implementation slice: Hardened `npm run decommission:readiness` so Airtable reconciliation is unstable when any recorded reconciliation result is not `pass`, preventing warnings from satisfying the final decommission gate.
- Decision: Added DEC-063. Final Airtable reconciliation blocks on rejected rows while accepted-row mapping checks avoid double-counting correctly rejected source rows as missing targets.
- Verification: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts` passed with 6 importer/reconciliation tests.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 13 PostgreSQL decommission tests and 70 skipped by filter.
- Verification failure: The first full gate failed during `npm test` because a broad global runtime-test truncation of migration tables increased PostgreSQL lock pressure; one follow-up test timed out and the next cleanup deadlocked. Resolution: removed migration tables from global runtime cleanup and truncated `migration.reconciliation_results` only inside the decommission tests that need reconciliation isolation.
- Verification: `npm run lint` and `npm run build` passed before the first full gate; after the isolation fix, focused importer and decommission tests passed again.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 172 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `aa79503`: Harden Airtable reconciliation readiness.

## 2026-08-01 Airtable Business Reconciliation Coverage

- Implementation slice: Expanded `npm run reconcile:airtable` with accepted-source business checks for lead status distribution, active lead count, stop-follow-up count, pending follow-up count, open/booked appointment count, and imported message provider-ID uniqueness.
- Implementation slice: Each business reconciliation check joins `migration.airtable_raw_records` through `migration.entity_map` to the target app table so only accepted imported rows are used as source-to-target evidence.
- Decision: Added DEC-064. Business reconciliation uses accepted source mappings and leaves unmapped or rejected rows to reject/mapping checks.
- Verification: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts` passed with 6 importer/reconciliation tests, including persisted business-count and lead-status-distribution reconciliation results.
- Verification: `npm run lint` and `npm run build` passed.
- Verification failure: The first full gate passed all 172 tests but failed in `tests/runtime.integration.test.ts` `afterAll` cleanup because the hook exceeded Vitest's 10 second timeout under load. Resolution: reran `npm test` successfully and then ran the remaining build/audit/smoke gate phases successfully; no code change was required because the failure occurred after all tests had passed and did not repeat.
- Verification: `npm test` passed on rerun with 17 files and 172 tests.
- Verification: `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; audit found 0 vulnerabilities, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `fb7a3fc`: Expand Airtable reconciliation coverage.

## 2026-08-01 Airtable Contact Opt-Out Preservation

- Implementation slice: Preserved contact opt-out state during Airtable Lead import by mapping `Opted Out` truthy values and opted-out `Consent Status` values into `app.contacts.opted_out`.
- Implementation slice: Preserved `Opt-Out Reason` on imported contacts and updated contact conflict handling so idempotent reruns keep opt-out state aligned with the accepted source row.
- Implementation slice: Added accepted-source reconciliation check `opt_out_count`, comparing opt-out source rows joined through `migration.entity_map` to imported `app.contacts.opted_out` rows.
- Decision: Added DEC-065. Contact opt-out is durable business state and must be carried into PostgreSQL authority rather than remaining display-only Airtable metadata.
- Verification: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts` passed with 6 importer/reconciliation tests, including imported opt-out reason and persisted `opt_out_count` evidence.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 172 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `051d7dc`: Preserve Airtable opt-out state.

## 2026-08-01 Airtable Decommission Reconciliation Suite Enforcement

- Implementation slice: Hardened `npm run decommission:readiness` so `airtable_reconciliation_stable` requires every required Airtable reconciliation check key to have recorded evidence.
- Implementation slice: Preserved the existing fail-closed behavior that any non-`pass` reconciliation result blocks Airtable removal readiness.
- Implementation slice: Added PostgreSQL integration coverage proving incomplete reconciliation evidence fails decommission readiness and that complete required reconciliation evidence is needed for the positive Airtable decommission fixture.
- Decision: Added DEC-066. Airtable decommission requires the complete reconciliation suite, not a single passing row or partial evidence set.
- Verification failure: The first broad focused run `npx vitest run tests/runtime.integration.test.ts -t "decommission"` hit a PostgreSQL cleanup hook timeout after several tests. Resolution: isolated the new and touched tests successfully, then reran the broad decommission-focused run successfully; no code weakening was required.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "non-pass Airtable"`, `npx vitest run tests/runtime.integration.test.ts -t "incomplete Airtable"`, `npx vitest run tests/runtime.integration.test.ts -t "passes decommission readiness"`, and `npx vitest run tests/runtime.integration.test.ts -t "cancelled Airtable projection"` passed individually.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 14 PostgreSQL decommission tests and 70 skipped by filter after the initial cleanup timeout did not repeat.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 173 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `66d3c46`: Require complete Airtable reconciliation for decommission.

## 2026-08-01 Airtable Reconciliation Check Contract Centralization

- Implementation slice: Moved the required Airtable reconciliation check-key list into a shared source module consumed by decommission readiness and re-exported for tests.
- Implementation slice: Hardened `npm run reconcile:airtable` with a required-check contract assertion so future missing or extra emitted checks fail before results are recorded.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts` passed with 6 importer/reconciliation tests.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 14 PostgreSQL decommission tests and 70 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 173 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `51c1fc0`: Centralize Airtable reconciliation check contract.

## 2026-08-01 Cutover Direct Ingress Target Enforcement

- Implementation slice: Hardened `npm run cutover:readiness` with `direct_ingress_target_selected`, which fails unless `DIRECT_META_WEBHOOK_ENABLED=true` or `DIRECT_LEAD_INGRESS_ENABLED=true`.
- Implementation slice: Added environment-provider injection to `CutoverReadinessService` so tests can prove fallback-only states without mutating cached process environment.
- Decision: Added DEC-067. n8n fallback and empty queues are not enough direct-ingress cutover evidence.
- Documentation slice: Updated the cutover runbook, direct-ingress plan, staging owner action, status, work queue, and next-action files so operators enable the approved direct route and runtime worker flags before using cutover readiness as route-change evidence.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness"` passed with 7 PostgreSQL cutover-readiness tests and 78 skipped by filter, including fallback-only cutover failure.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 174 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `29226e6`: Require direct ingress target for cutover readiness.

## 2026-08-01 Terminal Runtime Outbox Failure Cutover Gate

- Implementation slice: Hardened `npm run cutover:readiness` with `terminal_outbox_failures`, counting `runtime.outbox_commands` rows in `permanently_failed` or `dead_lettered` state directly from the durable outbox.
- Implementation slice: Added `terminalOutboxFailureCount` to the cutover readiness queue summary and updated the PostgreSQL cutover fixture so a terminal outbox command blocks cutover even when separate dead-letter evidence is not the source of truth.
- Decision: Added DEC-068. Terminal runtime outbox failures are unresolved external-effect state and block cutover independent of `runtime.dead_letters`.
- Documentation slice: Updated the cutover runbook, direct-ingress plan, production cutover owner action, status, work queue, and next action with terminal outbox failure monitoring.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "cutover readiness"` passed with 7 PostgreSQL cutover-readiness tests and 78 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 174 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `a228db1`: Block cutover on terminal runtime outbox failures.

## 2026-08-01 Decommission Stability Completion-Time Gate

- Implementation slice: Hardened `npm run decommission:readiness` so direct-ingress stability counts processed direct Meta inbound-message and website/Facebook lead events only when `runtime.inbox_events.completed_at` is older than the configured stability window.
- Implementation slice: Added PostgreSQL regression coverage proving old direct-ingress receipts completed recently do not satisfy `direct_ingress_stable`; direct fixtures now seed `completed_at` explicitly when they are meant to prove aged successful processing.
- Decision: Added DEC-069. Fallback removal readiness is based on aged successful Edge-owned processing, not merely aged durable receipt.
- Documentation slice: Updated the decommission runbook, direct-ingress plan, production cutover owner action, status, and work queue to distinguish receipt time from processing completion time.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 15 PostgreSQL decommission-readiness tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 175 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `3137324`: Measure decommission stability by completion time.

## 2026-08-01 Recent Legacy Activity Decommission Gate

- Implementation slice: Hardened `npm run decommission:readiness` with `recentLegacyConversationActivityCount`, counting legacy-owned conversations whose `created_at`, `updated_at`, or `last_inbound_at` falls inside the configured stability window.
- Implementation slice: Added `no_recent_legacy_conversation_activity` checks to both n8n and Typebot decommission areas so old terminal legacy conversations updated recently cannot satisfy fallback-removal readiness.
- Decision: Added DEC-070. Legacy fallback removal requires a quiet legacy activity window, not only no newly created or currently active legacy conversations.
- Documentation slice: Updated the decommission runbook, production cutover owner action, status, and work queue with the recent legacy activity blocker.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 16 PostgreSQL decommission-readiness tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 176 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `07dbe46`: Block decommission on recent legacy activity.

## 2026-08-01 Active Legacy Config Versioning Decommission Gate

- Implementation slice: Hardened `npm run decommission:readiness` with `unmigratedActiveLegacyConfigSnapshotCount`, counting active `edge_config_snapshots` rows that do not have a matching published immutable `configuration.versions` row.
- Implementation slice: Added the Typebot-area `active_legacy_config_snapshots_migrated` check so active legacy-only conversation content cannot satisfy Typebot removal readiness merely because some unrelated active versioned configuration exists.
- Decision: Added DEC-071. Active compatibility snapshots may remain only when they mirror published immutable configuration before Typebot removal.
- Documentation slice: Updated the decommission runbook, production cutover owner action, status, and work queue with the active legacy-only config blocker.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 17 PostgreSQL decommission-readiness tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 177 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `7a686b4`: Require versioned active config for Typebot removal.

## 2026-08-01 Edge-Owned Qualification Volume Decommission Gate

- Implementation slice: Hardened `npm run decommission:readiness` so Typebot qualification volume counts only completed `app.qualification_sessions` linked to matching `app.conversations` projected from `edge_conversations` with `stateAuthority='edge'`.
- Implementation slice: Added PostgreSQL regression coverage proving imported or detached completed qualification rows do not satisfy Typebot removal volume, while the positive decommission fixture now seeds Edge-owned conversation evidence explicitly.
- Decision: Added DEC-072. Typebot removal readiness measures successful Edge-owned qualifications, not imported migration history or synthetic detached rows.
- Documentation slice: Updated the decommission runbook and production cutover owner action with the Edge-owned qualification-volume evidence rule.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "decommission"` passed with 18 PostgreSQL decommission-readiness tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npx vitest run tests/runtime.integration.test.ts -t "decommission"`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 178 tests, audit found 0 vulnerabilities after one transient DNS failure/retry, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `b1482ad`: Count only Edge qualifications for Typebot removal.

## 2026-08-01 N8n Semantic Scheduled Authority Gate

- Implementation slice: Hardened `npm run decommission:readiness` so `no_n8n_scheduled_authority` inspects `runtime.scheduled_jobs.job_key`, `job_type`, `aggregate_key`, and `payload_json` for pending, processing, or retryable n8n-owned work.
- Implementation slice: Added PostgreSQL regression coverage proving a generic scheduled job type still blocks n8n decommission when its semantic job identity or aggregate key references n8n.
- Decision: Added DEC-073. Durable job semantic identity is decommission authority evidence, not only executable job type.
- Documentation slice: Updated the decommission runbook with the inspected scheduled-job fields.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "n8n semantic scheduled|decommission"` passed with 19 PostgreSQL decommission-readiness tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npx vitest run tests/runtime.integration.test.ts -t "n8n semantic scheduled|decommission"`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 179 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `19da1b0`: Detect n8n semantic scheduled authority.

## 2026-08-01 Direct Lead Source Stability Gate

- Implementation slice: Hardened `npm run decommission:readiness` so direct lead stability requires aged processed `website` `lead.created` and `facebook` `leadgen.created` evidence whenever `DIRECT_LEAD_INGRESS_ENABLED=true`.
- Implementation slice: Added `directWebsiteLeadStableEventCount` and `directFacebookLeadStableEventCount` metrics plus regression coverage proving website-only lead evidence fails fallback-removal readiness while positive fixtures seed both sources.
- Decision: Added DEC-074. The direct lead ingress flag exposes both website and Facebook routes, so one stable source cannot prove both routes are safe to use after fallback removal.
- Documentation slice: Updated the decommission runbook and production cutover owner action with the two-source lead stability evidence rule.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "n8n semantic scheduled|website and Facebook|decommission"` passed with 20 PostgreSQL readiness tests and 71 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npx vitest run tests/runtime.integration.test.ts -t "n8n semantic scheduled|website and Facebook|decommission"`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 180 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `f12d590`: Require website and Facebook lead stability.

## 2026-08-01 Published Active Configuration Decommission Gate

- Implementation slice: Hardened `npm run decommission:readiness` so Typebot `versioned_config_active` counts only active pointers joined to `configuration.versions.status='published'`.
- Implementation slice: Added PostgreSQL regression coverage proving an active pointer to a draft configuration version fails Typebot removal readiness.
- Decision: Added DEC-075. Draft configuration is editable and cannot prove immutable runtime content authority for Typebot removal.
- Documentation slice: Updated the decommission runbook and production cutover owner action with the published-active-version rule.
- Verification failure: The first focused run `npx vitest run tests/runtime.integration.test.ts -t "draft version|website and Facebook|n8n semantic scheduled|decommission"` failed because the new draft-config fixture did not clear legacy `edge_config_snapshots`, so it failed both `versioned_config_active` and `active_legacy_config_snapshots_migrated`. Resolution: explicitly truncated the legacy compatibility tables in the fixture, then reran the focused suite successfully.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "draft version|website and Facebook|n8n semantic scheduled|decommission"` passed with 21 PostgreSQL readiness tests and 71 skipped by filter after fixture cleanup.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npx vitest run tests/runtime.integration.test.ts -t "draft version|website and Facebook|n8n semantic scheduled|decommission"`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 181 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `4b60e30`: Require published active config for Typebot removal.

## 2026-08-09 Readiness Threshold Integer Parsing And Audit Lockfile Patch

- Implementation slice: Hardened `scripts/cutover-readiness.ts` and `scripts/decommission-readiness.ts` so numeric readiness thresholds reject decimal, negative, empty, infinite, and non-numeric values before any PostgreSQL query.
- Implementation slice: Added focused parser tests for decimal cutover queue-age and decommission stability-day values.
- Security slice: Ran `npm audit fix` after current registry audit data reported vulnerable transitive `fast-uri` and `nanoid` versions; only `package-lock.json` changed, updating `fast-uri` to `3.1.5` and `4.1.2`, and `nanoid` to `3.3.18`.
- Decision: Added DEC-076. Readiness threshold arguments are non-negative integers because they represent counts, seconds, and whole-day windows used in readiness evidence.
- Documentation slice: Updated the cutover and decommission runbooks with the integer threshold rule, and corrected direct lead decommission wording to require both website and Facebook evidence.
- Verification failure: The first current-turn `npm audit --audit-level=moderate` failed with two high-severity advisories in transitive packages `fast-uri` and `nanoid`.
- Resolution: `npm audit fix` updated the lockfile-only transitive package versions, then `npm ci` and `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- Verification: `npx vitest run tests/shell-scripts.test.ts -t "readiness CLI"` passed with 2 parser tests and 8 skipped by filter before and after `npm ci`.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 181 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `16f13d5`: Harden readiness threshold parsing.

## 2026-08-09 Canonical Readiness Threshold Syntax

- Implementation slice: Tightened `scripts/cutover-readiness.ts` and `scripts/decommission-readiness.ts` so threshold values must match canonical base-10 non-negative integer strings before JavaScript numeric conversion.
- Implementation slice: Added parser regression coverage for scientific notation, hexadecimal notation, and whitespace-padded threshold values.
- Decision update: Expanded DEC-076 to state that alternate JavaScript number syntaxes are invalid for readiness evidence.
- Documentation slice: Updated cutover and decommission runbooks, status, work queue, and next-action records with the canonical threshold syntax rule.
- Verification: `docker info --format '{{json .ServerVersion}}'` failed because `/var/run/docker.sock` is unavailable; Docker-backed dump metadata inspection and restore-smoke execution remain blocked by local daemon availability.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/shell-scripts.test.ts -t "readiness CLI"` passed with 2 parser tests and 8 skipped by filter before and after `npm ci`.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 181 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `0d690d7`: Require canonical readiness thresholds.

## 2026-08-09 Readiness Threshold Safe Integer Enforcement

- Implementation slice: Tightened readiness threshold parsing to use `Number.isSafeInteger` after canonical base-10 syntax validation, rejecting threshold values that would lose precision during JavaScript numeric conversion.
- Implementation slice: Added focused parser tests for unsafe cutover and decommission threshold values above `Number.MAX_SAFE_INTEGER`.
- Decision update: Expanded DEC-076 and runbooks to specify safe integers, not merely syntactic integers.
- Verification: `npm run lint` passed.
- Verification: `npx vitest run tests/shell-scripts.test.ts -t "readiness CLI"` passed with 2 parser tests and 8 skipped by filter before and after `npm ci`.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 181 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `89fa366`: Reject unsafe readiness thresholds.

## 2026-08-09 Worker Role Selection Validation

- Implementation slice: Changed `WORKER_KIND` environment validation from a free-form string to the closed role set `outbox` or `runtime`.
- Implementation slice: Added environment contract coverage proving an invalid worker kind fails before a worker can start the wrong loop.
- Decision: Added DEC-077. Worker kind is a closed deployment role because the worker entrypoint selects the legacy outbox worker unless `WORKER_KIND=runtime`.
- Documentation slice: Updated status, work queue, and next-action state with the closed worker-role rule.
- Verification: `npx vitest run tests/env-contract.test.ts` passed with 9 tests before and after `npm ci`.
- Verification: `npm run lint` passed before and after `npm ci`.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, and `npm run test:integration` passed; Vitest ran 17 files and 182 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `5a6c053`: Validate worker role selection.

## 2026-08-09 Deployment Probe Identity Scoping

- Implementation slice: Hardened `scripts/verify-deployment.sh` so direct Meta challenge probes, direct website/Facebook lead probes, n8n compatibility fallback probes, and shadow evaluation probes all derive event IDs from one per-run identifier.
- Implementation slice: Hardened `scripts/shadow-sequence.sh` so every turn in an operator shadow sequence uses the same per-run identity plus a counter instead of second-resolution event IDs.
- Implementation slice: Added ingress verifier coverage proving explicit verifier run IDs flow into direct-lead and n8n durable probe payloads, and static shell-script coverage preventing regression to second-only event IDs.
- Decision: Added DEC-078. Deployment and shadow probes use run-scoped durable IDs because durable inbox/outbox idempotency makes accidental event-ID reuse operationally misleading.
- Verification: `npx vitest run tests/ingress-gating.test.ts tests/shell-scripts.test.ts` passed with 2 files and 18 tests.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 182 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `cf86d71`: Scope deployment probe identities.

## 2026-08-09 Operator Env File Safe Parsing

- Implementation slice: Added `scripts/ops/read-env-file.py` to parse simple dotenv-style `KEY=value` assignments and emit NUL-delimited assignments for shell export without `source` or `eval`.
- Implementation slice: Updated `scripts/verify-deployment.sh` and `scripts/shadow-sequence.sh` to load env files through the parser, fail closed on parse errors before exporting values, and continue passing sensitive curl inputs through private temporary files.
- Implementation slice: Added shell-script coverage that compiles the parser, proves command substitutions remain literal data, prevents `source` regressions, and verifies the verifier still uses the safe loader.
- Decision: Added DEC-079. Operator env files are parsed, not sourced, because these scripts load secret-bearing env files and must not execute env-file shell content.
- Verification: `npx vitest run tests/shell-scripts.test.ts tests/ingress-gating.test.ts` passed with 2 files and 19 tests; `bash -n scripts/verify-deployment.sh` and `bash -n scripts/shadow-sequence.sh` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 183 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `e784a57`: Parse operator env files safely.

## 2026-08-09 Duplicate Operator Env Key Rejection

- Implementation slice: Hardened `scripts/ops/read-env-file.py` so duplicate env keys fail closed instead of allowing later values to silently override route flags or secrets.
- Implementation slice: Added shell-script regression coverage proving duplicate `DIRECT_META_WEBHOOK_ENABLED` assignments are rejected before operator scripts can use ambiguous values.
- Decision update: Expanded DEC-079 to include duplicate-key override rejection as part of parsed operator env-file handling.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 12 tests.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 184 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `add8a1e`: Reject duplicate operator env keys.

## 2026-08-09 Parsed Env Temp File Permissions

- Implementation slice: Hardened `scripts/verify-deployment.sh` and `scripts/shadow-sequence.sh` so parsed env assignment temp files are chmodded `600` before secret-bearing values are written.
- Implementation slice: Added static ingress and shell-script coverage proving both operator scripts preserve the private parsed-env temp-file permission step.
- Decision update: Expanded DEC-079 to record private temp-file handling for parsed env assignments.
- Verification: `npx vitest run tests/shell-scripts.test.ts tests/ingress-gating.test.ts` passed with 2 files and 20 tests.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 184 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `c39e7f4`: Protect parsed env temp files.

## 2026-08-09 Operator Env Control Character Rejection

- Implementation slice: Hardened `scripts/ops/read-env-file.py` so decoded NUL, newline, and carriage-return characters in env values fail closed before the NUL-delimited assignment stream is built.
- Implementation slice: Added shell-script parser coverage proving escaped NUL and escaped newline values are rejected.
- Decision update: Expanded DEC-079 to record one-line parsed env values and control-character rejection.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 13 tests.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 185 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `4639617`: Reject control characters in operator env values.

## 2026-08-09 Backup Output Overwrite Protection

- Implementation slice: Hardened `scripts/backup/backup-postgres.sh` so each encrypted dump/checksum output reserves a timestamped lock directory before writing.
- Implementation slice: Backup creation now refuses to overwrite existing encrypted dump or checksum paths for the selected timestamp and cleans up partial encrypted output/checksum files when backup exits before completion.
- Implementation slice: Added shell-script static coverage for the output lock, existing-output refusal, partial-output cleanup, and successful-completion guard.
- Decision: Added DEC-080. Timestamped backup outputs fail closed on collisions because second-precision filenames, concurrent runs, or stale checksum paths must not overwrite recovery evidence.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 14 tests before the full gate.
- Verification: `bash -n scripts/backup/backup-postgres.sh` passed.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 186 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `2b67fd1`: Prevent backup output overwrite.

## 2026-08-09 Backup Restore Checksum Verification

- Implementation slice: Added `scripts/backup/sha256-file.sh`, a portable SHA-256 helper that uses `sha256sum` when present and falls back to `shasum -a 256`.
- Implementation slice: Updated backup creation to write checksum files through the helper and updated restore to verify the encrypted dump checksum before decryption and PostgreSQL restore by default.
- Implementation slice: Added an explicit `RESTORE_SKIP_CHECKSUM=true` operator escape hatch for intentional unchecked restore, while malformed, unreadable, or mismatched checksum artifacts fail closed.
- Decision: Added DEC-081. Restore must verify encrypted backup artifacts before mutating a target database.
- Verification: `bash -n scripts/backup/backup-postgres.sh && bash -n scripts/backup/restore-postgres.sh && bash -n scripts/backup/sha256-file.sh && bash -n scripts/backup/verify-restore.sh` passed.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 16 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 188 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `716404c`: Verify backup checksum before restore.

## 2026-08-09 Calendar Reconciliation Argument Hardening

- Implementation slice: Hardened `scripts/calendar-reconcile.ts` so `list`, `confirm`, and `fail` are the only accepted commands and each command accepts only its known flags.
- Implementation slice: Calendar reconciliation now rejects duplicate flags, malformed outbox UUIDs, unsafe provider event IDs/reasons/operator IDs, non-canonical list limits, unsafe integer limits, and out-of-range limits before constructing `CalendarReconciliationService`.
- Implementation slice: Exported the parser for direct focused coverage and added regression tests proving bad operator arguments fail before PostgreSQL access.
- Decision: Added DEC-082. Calendar reconciliation is an operator mutation path and must fail closed on ambiguous CLI input.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 17 tests before the full gate.
- Verification: `npm run lint` passed before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 189 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `8e90b83`: Harden calendar reconciliation arguments.

## 2026-08-09 Versioned Configuration CLI Argument Hardening

- Implementation slice: Refactored `scripts/config.ts` to export a pure parser and to execute `main` only when invoked as the CLI script.
- Implementation slice: Hardened `npm run config` so `validate`, `diff`, `publish`, `active`, and `rollback` are the only accepted commands and each command accepts only its intended flags.
- Implementation slice: Configuration CLI parsing now rejects duplicate flags, simultaneous `--input` and `--airtable-export`, rollback without `--version`, command-inappropriate actor/source/version flags, and empty or control-character-bearing values before constructing `VersionedConfigService`.
- Decision: Added DEC-083. Configuration publish and rollback mutate active configuration authority, so ambiguous operator input must fail before PostgreSQL access.
- Verification: `npx vitest run tests/shell-scripts.test.ts tests/config-versioning.test.ts` passed with 2 files and 22 tests before the full gate.
- Verification: `npm run lint` passed before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 190 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `28ebd3d`: Harden configuration CLI arguments.

## 2026-08-09 Airtable Migration CLI Argument Hardening

- Implementation slice: Hardened `scripts/import-airtable.ts` so import requires explicit `--input=<dir>`, accepts only bare `--apply`, and rejects positional input, unknown flags, duplicate flags, empty paths, and control-character-bearing paths before loading source files.
- Implementation slice: Hardened `scripts/reconcile-airtable.ts` so reconciliation accepts only optional `--import-run-id=<uuid>` and bare `--record-results`, rejects malformed UUIDs, unknown flags, duplicate flags, and unsafe values before PostgreSQL access.
- Implementation slice: Tightened raw control-character checks in the calendar reconciliation and configuration CLI parsers after focused Airtable parser coverage exposed that trailing newlines were trimmed before validation.
- Decision: Added DEC-084. Airtable import/reconciliation commands write migration state and reconciliation evidence, so ambiguous operator input must fail closed.
- Verification failure: The first focused `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts` run failed because `--import-run-id=<uuid>\n` was trimmed before control-character validation. Resolution: reject control characters in raw parser values before trimming and add the same trailing-newline regression coverage to calendar/config parser tests.
- Verification: `npx vitest run tests/import-airtable.test.ts tests/import-airtable.integration.test.ts tests/shell-scripts.test.ts tests/config-versioning.test.ts` passed with 4 files and 30 tests.
- Verification: `npm run lint` passed before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 192 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `70a5f29`: Harden Airtable migration CLI arguments.

## 2026-08-09 Legacy Config Mutation Gate Hardening

- Implementation slice: Added `LEGACY_CONFIG_IMPORT_ENABLED` and `LEGACY_AIRTABLE_CONFIG_SYNC_ENABLED` environment flags, both disabled by default in validation and `.env.example`.
- Implementation slice: Gated `/internal/config/import` and `/internal/config/sync` after internal-secret authentication and before payload parsing, database work, or Airtable access.
- Implementation slice: Gated `ConfigSyncService.sync` so direct service use and `npm run sync-config` cannot read live Airtable unless the legacy compatibility flag is explicitly enabled and `AIRTABLE_TOKEN` is configured.
- Implementation slice: Refactored `scripts/sync-config.ts` to export a pure parser, execute only when invoked as a CLI, and reject positional, unknown, duplicate, empty, or control-character-bearing operator arguments before service use.
- Decision: Added DEC-085. Legacy config import and Airtable sync are compatibility paths, not normal immutable configuration authority.
- Verification failure: The first focused `npx vitest run tests/env-contract.test.ts tests/ingress-gating.test.ts tests/shell-scripts.test.ts` run failed because the new disabled-route test inherited direct-ingress flags from earlier app-injection tests. Resolution: pinned all route/runtime flags in that test to disabled values before rerunning successfully.
- Verification: `npx vitest run tests/env-contract.test.ts tests/ingress-gating.test.ts tests/shell-scripts.test.ts` passed with 3 files and 38 tests after the test isolation fix.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 195 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `74c71df`: Disable legacy config mutation paths by default.

## 2026-08-09 Versioned Seed Configuration Authority

- Implementation slice: Changed `npm run seed` from direct `edge_config_snapshots` writes to `VersionedConfigService.publish`, so seed bootstrap creates or reuses immutable published configuration, activates the default scope, and maintains the legacy compatibility snapshot through the same versioned path.
- Implementation slice: Seed now skips only when the default `configuration.active_versions` pointer already exists, rather than treating a legacy-only active snapshot as sufficient runtime authority.
- Implementation slice: Added PostgreSQL regression coverage proving `npm run seed` creates one published version, one default active pointer, one matching legacy compatibility snapshot, and remains idempotent on rerun.
- Decision: Added DEC-086. Seed bootstrap must not create legacy-only configuration authority.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "seeds configuration|publishes immutable versioned configuration|activates and rolls back"` passed with 1 file, 3 tests, and 90 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 196 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `a4f2b5e`: Publish seed config through versioned authority.

## 2026-08-09 Seed CLI Argument Hardening

- Implementation slice: Refactored `scripts/seed.ts` to export a pure no-argument parser, run only under direct CLI invocation, and keep pool cleanup in the wrapper.
- Implementation slice: `npm run seed` now rejects unknown or control-character-bearing arguments before querying PostgreSQL or publishing seed configuration.
- Implementation slice: Added shell-script parser coverage proving seed arguments fail closed while the existing PostgreSQL seed authority test remains green.
- Decision: Added DEC-087. Seed is a closed no-argument bootstrap command because ignored arguments could publish the wrong source while appearing successful.
- Verification: `npx vitest run tests/shell-scripts.test.ts tests/runtime.integration.test.ts -t "seed CLI|seeds configuration"` passed with 2 files, 2 tests, and 111 skipped by filter.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 197 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `28aba0d`: Harden seed CLI arguments.

## 2026-08-09 Migrator CLI Argument Hardening

- Implementation slice: Added a pure no-argument parser to `scripts/migrate.ts` and routed direct CLI execution through `runCli`, so argument validation happens before database/logger runtime modules are imported.
- Implementation slice: `npm run migrate` and `npm run migrate:prod` now reject unknown or control-character-bearing arguments before opening PostgreSQL or mutating schema state.
- Implementation slice: Added migrator parser coverage alongside checksum coverage.
- Decision: Added DEC-088. The migrator is a closed no-argument command because ignored migration flags or alternate paths can create misleading schema authority evidence.
- Verification: `npx vitest run tests/migrate.test.ts tests/shell-scripts.test.ts` passed with 2 files and 25 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 198 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `78a53f3`: Harden migrator CLI arguments.

## 2026-08-09 Backup Restore Script Argument Hardening

- Implementation slice: Hardened `scripts/backup/backup-postgres.sh`, `scripts/backup/restore-postgres.sh`, and `scripts/backup/verify-restore.sh` so they reject all positional or flag arguments before reading required environment variables.
- Implementation slice: Added executable shell-script coverage proving backup/restore argument rejection happens before secret-bearing env validation.
- Decision: Added DEC-089. Backup and restore scripts are env-only commands because ignored arguments can mislead operators about the source database, target database, dump, checksum, or password file.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 1 file and 21 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 199 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `c5f8a4c`: Harden backup restore script arguments.

## 2026-08-09 Operator Verification Script Argument Hardening

- Implementation slice: Hardened `scripts/verify-deployment.sh` so duplicate, empty, unknown, or control-character-bearing operator arguments fail before env-file loading, route checks, or durable verification probes.
- Implementation slice: Hardened `scripts/shadow-sequence.sh`, `scripts/ops/inspect-dump-metadata.sh`, and `scripts/ops/restore-dump-smoke.sh` as env-only commands that reject all positional or flag arguments before reading `.env`, `DUMP_PATH`, or invoking Docker.
- Implementation slice: Added executable shell-script coverage proving deployment verifier and env-only probe/dump argument rejection happens before secret-bearing env or Docker inputs.
- Decision: Added DEC-090. Operator verification scripts create or inspect operational evidence, so ambiguous CLI input must fail closed before evidence-producing actions.
- Verification: `npx vitest run tests/shell-scripts.test.ts tests/ingress-gating.test.ts` passed with 2 files and 32 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 201 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `d758c7e`: Harden operator verification script arguments.

## 2026-08-09 Utility Script Argument Hardening

- Implementation slice: Hardened `scripts/generate-env.sh` and `scripts/ops/scan-tracked-artifacts.sh` as no-argument utilities so typoed flags fail before `.env` generation or tracked-artifact evidence.
- Implementation slice: Hardened `scripts/smoke-engine.ts`, `scripts/smoke-integration.ts`, and `scripts/simulate-conversation.ts` so unexpected or control-character-bearing arguments fail before default-seed smoke/simulation evidence is produced.
- Implementation slice: Hardened `scripts/backup/sha256-file.sh` so it accepts exactly one readable safe path and rejects missing, extra, empty, newline, carriage-return, or tab-bearing path arguments before readability checks.
- Decision: Added DEC-091. Utility scripts create local files or verification evidence and must fail closed on unexpected operator input.
- Verification failure: The first full `npm test -- --silent` run timed out the new utility-script rejection test after 5000 ms because it spawned `npx tsx` three times under full-suite load. Resolution: invoke the local `node_modules/.bin/tsx` binary directly in the executable regression test, preserving the same script behavior without package-runner startup overhead.
- Verification: `npx vitest run tests/shell-scripts.test.ts` passed with 1 file and 24 tests before the full gate and again after the timeout resolution.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed after the resolution; Vitest ran 17 files and 202 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `b63e996`: Harden utility script arguments.

## 2026-08-09 Runtime Idempotency Collision Hardening

- Implementation slice: Hardened `RuntimeOutboxRepository.enqueue` so duplicate outbox idempotency keys reuse existing commands only when command type, destination, aggregate key, payload, and maximum-attempt policy match the persisted row.
- Implementation slice: Hardened `JobRepository.schedule` so duplicate scheduled-job semantic keys reuse existing jobs only when job type, aggregate key, payload, due time, timezone, recurrence, and maximum-attempt policy match the persisted row.
- Implementation slice: Added PostgreSQL regression coverage proving changed outbox command semantics and changed scheduled-job semantics fail closed without creating duplicate durable rows.
- Decision: Added DEC-092. Runtime idempotency keys are replay protection and must not silently alias changed external effects or schedules.
- Verification: `npx vitest run tests/runtime.integration.test.ts` passed with 1 file and 94 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 203 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `f8707e4`: Harden runtime idempotency collisions.

## 2026-08-09 Inbox Dedupe Payload Collision Hardening

- Implementation slice: Hardened `InboxRepository.receive` so duplicate provider dedupe keys reuse the existing inbox row only when event type, external event ID, aggregate key, and payload hash match.
- Implementation slice: Added PostgreSQL regression coverage proving a reused provider event ID with a changed payload fails closed without creating a second receipt/event or altering the original payload.
- Decision: Added DEC-093. Provider dedupe keys are replay protection and must not silently suppress changed payloads.
- Verification failure: The first focused runtime integration run failed because the existing duplicate-inbox fixture omitted the aggregate key used by the original receipt, making it a semantic collision. Resolution: changed the duplicate fixture to represent a true retry with matching aggregate identity and retained a separate collision test for changed payloads.
- Verification: `npx vitest run tests/runtime.integration.test.ts` passed after the fixture correction with 1 file and 95 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 204 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `ad329be`: Reject inbox dedupe payload collisions.

## 2026-08-09 Appointment Booking Idempotency Collision Hardening

- Implementation slice: Hardened `AppointmentService.bookSlot` so duplicate booking source-event keys return an existing appointment only when the requested slot and booking actor match the stored appointment.
- Implementation slice: Added PostgreSQL regression coverage proving a reused appointment source event for a different slot fails closed without creating a second appointment or calendar outbox command.
- Decision: Added DEC-094. Appointment booking source-event keys protect a specific customer slot reply and must not alias changed booking semantics.
- Verification: `npx vitest run tests/runtime.integration.test.ts` passed with 1 file and 96 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 205 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `a9270b3`: Reject appointment booking idempotency collisions.

## 2026-08-09 Lead Intake Idempotency Collision Hardening

- Implementation slice: Hardened `LeadIntakeService.intake` so duplicate provider/source idempotency keys return an existing intake event only when lead, contact, provider external ID, and payload hash match the persisted receipt.
- Implementation slice: Replaced the mutable lead-intake event conflict update with immutable insert-or-read collision detection, preserving the original contact, lead, intake event, projection outbox command, and audit evidence on changed-payload reuse.
- Implementation slice: Added PostgreSQL regression coverage proving a reused lead-intake source event with changed contact/source payload semantics fails closed without creating duplicate durable rows or mutating the accepted source payload evidence.
- Decision: Added DEC-095. Lead intake events are immutable durable receipts, not mutable aliases for changed provider/source payloads.
- Verification failure: The first focused runtime integration run failed after a local stall when an existing Meta inbound processing test timed out. Resolution: the new lead-intake collision test passed in isolation, then the full focused runtime integration file passed on rerun.
- Verification: `npx vitest run tests/runtime.integration.test.ts -t "lead intake idempotency collisions"` passed with 1 test and 96 skipped by filter.
- Verification: `npx vitest run tests/runtime.integration.test.ts` passed on rerun with 1 file and 97 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 206 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `837c3d4`: Reject lead intake idempotency collisions.

## 2026-08-09 Legacy Edge Outbox Idempotency Collision Hardening

- Implementation slice: Hardened `OutboxRepository.enqueue` for the legacy `edge_outbox` compatibility path so a duplicate idempotency key is accepted only when conversation, event type, payload, and parked-vs-deliverable intent match the persisted row.
- Implementation slice: Added PostgreSQL regression coverage proving true duplicate legacy outbox enqueues remain idempotent while changed payload semantics fail closed and preserve the original compatibility event.
- Decision: Added DEC-096. Legacy outbox rows remain rollback/fallback evidence until decommission and must not silently alias changed events.
- Verification: `npx vitest run tests/runtime.integration.test.ts` passed with 1 file and 98 tests before the full gate.
- Verification: `npm ci`, `npm run artifacts:scan`, `npm run lint`, `npm test -- --silent`, `npm run build`, `test ! -d dist/tests`, `npm audit --audit-level=moderate`, `npm run test:smoke`, `npm run test:integration`, and `git diff --check` passed; Vitest ran 17 files and 207 tests, audit found 0 vulnerabilities, tracked artifact scan passed, smoke returned `ok=true`, and integration smoke returned `ok=true`.
- Commit `5e8e3c4`: Reject legacy outbox idempotency collisions.

## 2026-08-16 Dashboard API: Authentication, Read Surface, Actions, Realtime

- Implementation slice: Added migration `024_dashboard_users_sessions.sql` creating `app.users`, `app.sessions`, and `app.login_attempts`. No existing table's columns or constraints were altered.
- Implementation slice: Added migration `025_dashboard_realtime_notify.sql` creating `LISTEN/NOTIFY` triggers on `app.leads`, `app.messages`, `app.lead_assignments`, and `app.notifications` that publish identifiers only, never message bodies or PII.
- Implementation slice: Added Argon2id password hashing via `@node-rs/argon2`, chosen over the `argon2` package because the runtime image is `node:22-alpine` and `@node-rs` ships musl prebuilds, so no C toolchain is added to the image.
- Implementation slice: Added `/api/auth/{login,logout,me,refresh,password}` with opaque 32-byte session tokens stored as SHA-256 digests and compared with `timingSafeEqual`, returned both in the body for mobile clients and as an `HttpOnly; SameSite=Lax` cookie for web.
- Implementation slice: Added durable login throttling in `app.login_attempts` at five attempts per fifteen minutes per IP and per email, shared across API instances and cleared by a successful login.
- Implementation slice: Added a Fastify `preHandler` session hook and role authorisation, with every dashboard query scoped by `client_id` inside the SQL `WHERE` clause through a single `leadVisibilitySql` helper.
- Implementation slice: Added the dashboard read surface: paginated and filterable `/api/leads`, full `/api/leads/:id` detail including qualification answers in configured order, the score breakdown with `missingAnswers`, the routing run with all candidate match flags, assignment history and message thread, plus `/api/notifications`, `/api/salespeople`, `/api/projects`, `/api/dashboard/summary`, `/api/dashboard/activity`, and `/api/users`.
- Implementation slice: Added dashboard actions. `acknowledge` cancels the pending SLA reminder and escalation in `runtime.scheduled_jobs` in the same transaction as the acknowledgement and writes an `audit.events` row. `takeover` writes `edge_lead_controls.human_takeover`, the overlay the conversation engine consults, and pre-seeds it when no conversation exists yet. `close` and `stop-followup` cancel the affected scheduled jobs through the existing follow-up and SLA services.
- Implementation slice: Added `/api/leads/:id/reply` enqueuing a `whatsapp.send_message` outbox command through the existing `MessageRequestService`, never calling Meta inline, with a caller-supplied stable `requestKey` so an offline retry cannot double-send.
- Implementation slice: Added SSE at `/api/stream` backed by one dedicated `LISTEN` connection with reconnect backoff, re-checking lead visibility in SQL before delivering to a salesperson rather than trusting the notification payload.
- Implementation slice: Added `npm run user:create` to create the first admin user, since there is no signup route and accounts are created by admins.
- Defect found and fixed during verification: `GET /api/leads/:id/messages` answered `200` with an empty thread for another client's lead instead of `404`. No data leaked, but an invisible lead must be indistinguishable from a missing one; the route now resolves visibility before reading the thread.
- Decision: Added DEC-097, DEC-098, and DEC-099.
- Constraint note: `app.leads.last_message_at` and `first_reply_at` are never written by the runtime, and `audit.events.client_id` is never populated by `AuditRepository`. The dashboard derives recency and the session window from `app.messages`, and scopes the activity feed by resolving each event's aggregate. Both are documented in `docs/DASHBOARD_API.md` rather than fixed here, because the conversation engine is out of scope.
- Verification: `npx vitest run tests/dashboard-api.integration.test.ts` passed with 1 file and 36 tests against a disposable PostgreSQL cluster.
- Verification: `npm run lint`, `npm test`, and `npm run build` passed; Vitest ran 19 files and 183 tests.
