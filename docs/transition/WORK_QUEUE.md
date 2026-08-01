# Work Queue

Last updated: 2026-08-01

## MP-01 Baseline, Security, Source Cleanup

Status: locally_verified

Deliverables: clean repository, strict ignore rules, tracked-artifact scan, sanitized fixtures, owner-action docs, source inventory, duplicate-tree decision.

Dependencies: none.

Verification gates: `npm run artifacts:scan`, `npm ci`, lint, tests, build, audit, smoke.

Remaining: none except ongoing secret hygiene.

## MP-02 Build, Deployment, Migrations, Recovery

Status: locally_verified

Deliverables: lockfile, fixed compiled paths, runtime-only production build output, one-shot migrator, migration checksums/advisory lock, readiness, operational worker heartbeat checks, backup/restore scripts with private libpq service-file connection handling, PostgreSQL 16 dump inspect/restore-smoke wrappers, environment template, enabled-integration credential validation, generated env rendering that avoids secret-bearing process arguments, container topology with API/worker startup free of migrations and configuration seeding.

Dependencies: Docker daemon for image run and Docker-based dump inspection.

Verification gates: serial npm gate, disposable PostgreSQL migration/idempotency/checksum/concurrency, backup/restore, readiness, heartbeat, environment contract, static Compose config, shell syntax checks.

Remaining: Docker image run and Docker-backed dump metadata/restore-smoke execution when daemon is available.

## MP-03 PostgreSQL Core And Airtable Migration

Status: locally_verified

Deliverables: app/runtime/configuration/audit/migration schemas, per-table importer, raw records, reject capture, entity maps, relationship validation, collision reporting, dry-run/apply summaries, reconciliation report, projection readiness.

Dependencies: complete Airtable export for production reconciliation.

Verification gates: synthetic malformed/duplicate/missing-relationship fixtures, idempotent rerun, partial failure rollback, disposable PostgreSQL apply/reconcile, documented field map.

Remaining: broader real-export reconciliation checks and full reconciliation blocked on export.

## MP-04 Durable Inbox, Outbox, Jobs, Audit

Status: locally_verified

Deliverables: inbox receipt/claim/retry/dead-letter/replay, outbox commands/attempt history/provider failure classification, scheduled jobs with retry and direct dead-letter outcomes, audit service, bounded jittered retry backoff, bounded legacy outbox compatibility retries.

Dependencies: none for internal implementation.

Verification gates: real PostgreSQL concurrency/lease/retry/dead-letter/atomicity/job/audit tests.

Remaining: provider-specific dispatchers and business processors are intentionally deferred to MP-05 through MP-10. The runtime worker is present but disabled unless real handlers are configured.

## MP-05 WhatsApp Messaging Platform

Status: staging_blocked

Deliverables: internal message request API, Meta adapter, templates, window policy, status events with monotonic current-state advancement, delivery unknown handling, n8n compatibility route.

Dependencies: Meta credentials/templates for live verification.

Verification gates: contract fixtures for payloads/status/errors/timeouts; durable outbox dispatcher integration; live staging pending owner action.

Completed locally: signed Meta delivery-status webhooks and authenticated n8n-compatible status callbacks durably receipt into `runtime.inbox_events`, process through the runtime worker, persist distinct provider delivery events, and advance the current `app.messages.state` monotonically so out-of-order older statuses cannot regress reporting state. n8n-compatible status callbacks acknowledge durable receipt before client relationship resolution, leaving missing-message outcomes to worker retry/dead-letter policy.

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

Completed locally: durable Meta message receipt for signed webhook payloads, worker-owned ignored outcomes for unsupported signed Meta webhook receipts, authenticated n8n-compatible inbound receipt before client relationship resolution, combined Meta inbox processor for status and inbound message events, edge-only ownership gate, legacy-owned Typebot fallback ignore path, qualification answer persistence, audit event recording, transactional outbound WhatsApp outbox enqueue without live Meta calls, explicit opt-out persistence to Edge/app lead/contact/control state, human-takeover suppression without outbound side effects, English/Arabic final-question completion, completed qualification sessions with configuration pins, qualified lead-state persistence, replay idempotency for final handoff effects, and source-to-app projection for app conversations, inbound app messages, outbound app messages, and qualification sessions.

Remaining: live staged Meta/n8n turn verification pending owner setup. Broader full-conversation fixtures can be added as hardening, but the locally implementable core path has PostgreSQL/API coverage.

## MP-09 Scoring, Routing, Commands, Alerts

Status: staging_blocked

Deliverables: `real_estate_v1` scoring, deterministic routing, salesperson commands, authorized alerts.

Dependencies: salesperson/project export for final data parity.

Verification gates: parity fixtures, cross-client rejection, deterministic tie-breaks.

Completed locally: deterministic `real_estate_v1` score calculation from normalized qualification answers and lead state; score-run idempotency using scoring version plus input hash; atomic update of `app.leads.lead_score` and `app.leads.temperature`; `lead.scored` audit events; deterministic `real_estate_v1` routing runs with same-client/project salesperson eligibility; cross-client salesperson rejection even when project links are malformed; stable candidate tie-breaks; active-assignment reuse on rerun; durable `salesperson.lead_assignment_notification` and `operator.routing_attention_required` outbox commands; real dispatcher mapping for those notification command types through the Meta WhatsApp adapter path with provider retry/permanent/unknown classification preserved; authenticated n8n-compatible salesperson command receipt into `runtime.inbox_events`; durable command processing for acknowledgement, takeover, close-lost, and stop-follow-up; unauthorized sender rejection; PostgreSQL/API integration coverage for completed qualification scoring, duplicate reruns, missing-answer reporting, routing tie-breaks, no-eligible routing, cross-client rejection, duplicate command idempotency, unauthorized command rejection, command state mutations, notification dispatch mapping, and malformed notification rejection.

Remaining: live staging verification for salesperson/operator notification sends and command ingestion; approved notification copy/templates; parity against real salesperson/project export when available.

## MP-10 Follow-ups, SLA, Reporting

Status: staging_blocked

Deliverables: durable scheduled followups, SLA reminders/escalations, daily reports.

Dependencies: client report recipients/templates for live sends.

Verification gates: durable job restart, cancellation, SQL reconciliation.

Completed locally: semantic follow-up identity on `app.followups`; durable `runtime.scheduled_jobs` scheduling with explicit client timezone; duplicate schedule requests return the existing follow-up/job without duplicate rows or audit; cancellation of scheduled follow-ups/jobs on assignment, qualification completion, opt-out, takeover, close-lost, and stop-follow-up paths; due `followup.send` job execution through `RuntimeWorker`; follow-up send revalidation before outbound effects; atomic outbound `app.messages` plus `runtime.outbox_commands` enqueue; expired job lease recovery before follow-up send; semantic SLA identity on `app.sla_jobs`; assignment acknowledgement reminders and escalations scheduled with durable runtime jobs; stale qualified lead escalation scheduled when routing produces no eligible salesperson; SLA cancellation on acknowledgement, close-lost, stop-follow-up, takeover, and opt-out; due SLA jobs revalidate lead/assignment state before enqueuing durable salesperson/operator notification commands; expired SLA job lease recovery; dispatcher mapping for SLA notification command types through the Meta adapter path; semantic daily report identity on `app.daily_reports`; explicit report timezone and date; idempotent report schedules; report cancellation/supersession; expired report job lease recovery; SQL-backed report summaries for intake, qualification, assignment acknowledgement, SLA escalations, follow-ups, outbound delivery state, and dead letters; durable `operator.daily_report` outbox command mapping through the Meta adapter path; successful daily report execution materializes the next semantic daily report/job in the same PostgreSQL transaction while preserving the configured local report time across DST; PostgreSQL integration tests for duplicate prevention, timezone/job storage, assignment cancellation, salesperson close-lost cancellation, single follow-up execution, pre-send cancellation, follow-up lease recovery, SLA idempotent scheduling, acknowledgement cancellation, SLA reminder/escalation execution idempotency, stale-qualified lease recovery, stale SLA cancellation, daily report duplicate schedules, cancelled reports, expired report leases, report row-count accuracy, report outbox idempotency, and recurring daily report materialization.

Remaining: live report recipient/template verification when owner inputs are available.

## MP-11 Appointments And Calendar

Status: staging_blocked

Deliverables: offer generation, slot persistence/locking, Google availability/recheck/create-event adapter.

Dependencies: Google Calendar credentials for live verification.

Verification gates: concurrent booking, duplicate reply, provider failure handling.

Completed locally: semantic appointment offers and slots; offer idempotency independent of slot order; offer cancellation/supersession; PostgreSQL row locks for booking; duplicate booking reply idempotency; concurrent slot reply handling that creates one appointment; booked appointment state transition; durable `calendar.create_event` outbox command inserted after appointment state changes; disabled-by-default Google Calendar adapter shape requiring real credentials; Google free/busy availability check; pre-create availability recheck in the calendar dispatcher; busy slots rejected without event creation; calendar outbox dispatcher preserving created/retryable/permanent/unknown provider classifications; free/busy network failures are retryable before create; Google numeric/date retry hints are bounded; create-event network failures become delivery-unknown to preserve replay safety; delivered calendar create commands persist provider event IDs back to `app.appointments` and confirm appointments; delivery-unknown calendar creates remain unclaimable for automatic replay and do not blindly generate duplicate provider events; `npm run calendar:reconcile` lists ambiguous calendar creates and lets an operator attach a verified provider event ID or mark the create permanently failed without calling Google; local PostgreSQL and dispatcher tests for offer idempotency, cancellation, concurrent booking, duplicate reply replay, malformed calendar payload rejection, availability busy rejection, availability retry hints, provider create retry hints, missing credential rejection, provider event ID persistence, delivery-unknown replay safety, and idempotent operator reconciliation.

Remaining: live Google Calendar availability/create/delete/duplicate-booking verification pending owner credentials/calendar IDs.

## MP-12 Direct Ingress, Rollout, Decommission

Status: staging_blocked

Deliverables: direct callback compatibility, Caddy route plan, rollout overrides, decommission criteria/runbooks.

Dependencies: DNS/Caddy/production owner action.

Verification gates: staging ingress, canary metrics, explicit owner approval for removals.

Completed locally: direct Meta webhook route is disabled by default unless `DIRECT_META_WEBHOOK_ENABLED=true`; direct website/Facebook lead ingress is disabled by default unless `DIRECT_LEAD_INGRESS_ENABLED=true`; direct route flags fail startup validation without their required runtime worker processing flags; direct Meta signed unsupported webhooks are durably receipted and then ignored by the runtime worker; direct lead routes authenticate, durably receipt, deduplicate, and acknowledge without running lead-intake business logic inside the HTTP request; runtime inbox workers claim only configured provider/event-type subsets and process website/Facebook lead receipts into `LeadIntakeService`; legacy synchronous `/v1/turn` active compatibility is disabled by default unless `ACTIVE_TURN_COMPAT_ENABLED=true`; n8n compatibility routes remain independently gated by `N8N_COMPAT_ROUTES_ENABLED` and callback routes durably receipt before client relationship resolution; local app-injection tests prove disabled direct routes and legacy active-turn compatibility return 503 without provider calls while n8n compatibility remains available when explicitly enabled; `npm run cutover:readiness` provides a read-only PostgreSQL-backed readiness report for direct-route flags, required direct-inbox processor metadata including `whatsapp.webhook_ignored`, legacy active-turn compatibility state, n8n compatibility, pending/oldest inbox, outbox, and due scheduled-job work, delivery-unknown counts, dead-letter counts, and runtime worker heartbeat age plus operational metadata; future scheduled jobs are reported separately from due work and do not block cutover readiness; disabled runtime worker heartbeats or heartbeats missing required direct-inbox provider/event metadata do not satisfy cutover readiness when the corresponding direct ingress flag is enabled; cutover/decommission readiness CLIs reject unknown or malformed operator arguments before querying PostgreSQL; `docs/transition/DIRECT_INGRESS_PLAN.md` documents staging and production canary route shapes, required flags, rollback, and decommission hold; `scripts/verify-deployment.sh` accepts `--base-url`, `--env-file`, direct ingress check flags, and skip flags so staging can verify direct Meta challenge, signed non-customer Meta webhook receipt, and direct website/Facebook lead ingress enabled/disabled behavior without real customer messages, while keeping sourced env values shell-local and passing sensitive curl inputs through private temporary files; `scripts/shadow-sequence.sh` also keeps sourced env values shell-local and passes `EDGE_SHARED_SECRET` through a private temporary header file; the enabled direct-lead checks expect durable receipt acknowledgement from non-business probes instead of creating authoritative leads; `npm run decommission:readiness` provides a read-only PostgreSQL-backed exit report for n8n, Typebot, and Airtable projection retirement, including current direct-ingress runtime authority, fresh matching runtime-worker heartbeat metadata, legacy active-turn compatibility state, legacy conversation activity, processed direct business-ingress stability evidence matched to every currently enabled direct route family, parked or dead-lettered legacy edge outbox work, unresolved or dead-lettered n8n compatibility work, rejected n8n salesperson command outcomes, Airtable projection/reconciliation state including cancelled projection commands, migrated content/config evidence, final export flags, and explicit owner approval flags. Ignored deployment probes and provider delivery-status callbacks do not count as decommission stability evidence.

Remaining: staging ingress verification, live provider/source verification, production cutover owner approval, final legacy/Airtable exports, owner approval flags for decommission readiness, and all destructive fallback removals.
