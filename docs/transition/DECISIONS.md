# Decisions

## DEC-001: Clean Repository Location

Decision: Use `/Users/yassinkhalil/Developer/lead-conversion-core` as the clean canonical implementation repository.

Reason: The supplied evidence folder is not a Git repository and contains secret-bearing/runtime artifacts that must remain read-only.

Date: 2026-07-30

## DEC-023: Calendar Dispatch Rechecks Availability Before Create

Decision: `calendar.create_event` dispatch performs a provider availability check immediately before creating the calendar event, and a busy result becomes a definite non-retryable rejection without calling create.

Reason: Slot state is authoritative in PostgreSQL, but provider calendar availability can change after the customer selects a slot. Rechecking outside the booking transaction avoids external HTTP in database transactions while preventing known-busy provider slots from creating duplicate or invalid events.

Date: 2026-07-30

## DEC-022: Appointment Booking State Precedes Calendar Side Effects

Decision: Appointment slot booking uses PostgreSQL locks and idempotency keys to create one authoritative `app.appointments` row before inserting a durable `calendar.create_event` outbox command.

Reason: Calendar creation is an external side effect and must not run inside the booking transaction. PostgreSQL remains the authority for offer, slot, and appointment state; provider dispatch can retry or dead-letter without duplicating the customer booking.

Date: 2026-07-30

## DEC-021: Daily Reports Are Generated From Authoritative SQL At Execution Time

Decision: Daily reports persist semantic `app.daily_reports` rows linked to `runtime.scheduled_jobs`, and workers generate report summaries from authoritative PostgreSQL tables when the job executes before inserting one idempotent `operator.daily_report` outbox command.

Reason: Report data must be durable, replayable, and auditable without maintaining a second reporting authority. Generating from SQL inside the worker transaction keeps the report tied to the persisted report date/timezone and prevents in-memory timers or stale snapshots from becoming durable scheduling state.

Date: 2026-07-30

## DEC-020: SLA Enforcement Uses Semantic Runtime Jobs

Decision: SLA reminders and escalations persist `app.sla_jobs` rows linked to semantic `runtime.scheduled_jobs` records, and due SLA jobs enqueue durable outbox commands only after revalidating current lead/assignment state.

Reason: SLA work must be deduplicated, cancellable, auditable, and recoverable by PostgreSQL leases. Revalidation prevents stale reminders after acknowledgement, opt-out, close, takeover, or reassignment, while outbox commands preserve the rule that external effects are requested transactionally and dispatched later by workers.

Date: 2026-07-30

## DEC-019: Follow-Ups Use Semantic Runtime Jobs

Decision: Follow-up scheduling persists both `app.followups` and `runtime.scheduled_jobs` using the same semantic key, including lead, sequence, stage, and step order.

Reason: Follow-up work must be durable, deduplicated, cancellable, and recoverable by workers. In-process timers cannot be the scheduling authority.

Date: 2026-07-30

## DEC-018: Notification Commands Dispatch Through The Messaging Adapter

Decision: `salesperson.lead_assignment_notification` and `operator.routing_attention_required` outbox commands are dispatched by mapping their durable payloads to real Meta WhatsApp sends through `MessagingOutboxDispatcher`.

Reason: The outbox must not accumulate command types that the worker immediately marks unsupported once dispatch is enabled. Mapping to the existing provider adapter preserves real provider retry/permanent/unknown classification without hardcoded success responses.

Date: 2026-07-30

## DEC-017: Salesperson Commands Are Durable Inbox Events

Decision: Salesperson command compatibility ingress stores sanitized WhatsApp/n8n command payloads in `runtime.inbox_events` before processing, and command effects are applied only by the worker after validating the sender is the active assignee for the lead/client.

Reason: Salesperson commands mutate assignment and lead control state. They need the same receipt, dedupe, replay, authorization, and audit guarantees as external lead and conversation events.

Date: 2026-07-30

## DEC-016: Existing Active Assignments Are Routing Authority

Decision: `real_estate_v1` routing reuses an existing active `app.lead_assignments` row for a lead and does not recompute a different assignee until a future explicit reassignment or supersession command exists.

Reason: Assignment itself changes candidate load, so blindly rerouting after assignment can produce a different winner. During this phase, stable replay/idempotency is more important than automatic reassignment.

Date: 2026-07-30

## DEC-015: Scoring Is Snapshot-Idempotent

Decision: `real_estate_v1` scoring uses normalized qualification answers plus lead state as its input snapshot and persists score runs with a unique `(lead_id, scoring_version, input_hash)` identity for computed score runs; legacy imported score rows are excluded from that uniqueness predicate with the explicit `legacy-import` hash.

Reason: The same qualification state must not create duplicate score runs on webhook replay or operator rerun, while changed answers or future scoring versions must remain auditable as distinct durable runs. Existing historical imports must not be forced into a synthetic uniqueness guarantee they did not originally have.

Date: 2026-07-30

## DEC-002: Initial Canonical Source

Decision: Start from `source/conversation-edge` after verifying the duplicate tree `source/lead-conversion-os-active-test-v2/conversation-edge` is byte-identical by `diff -rq`.

Reason: It is the smallest canonical edge implementation and avoids copying broader evidence, deployment history, and runtime artifacts.

Date: 2026-07-30

## DEC-003: Runtime Stack

Decision: Keep Node.js 22+, TypeScript, Fastify, `pg`, Zod, Pino, `prom-client`, Vitest, and PostgreSQL 16.

Reason: This matches the supplied implementation and the migration brief; no evidenced need exists for an ORM or external orchestrator.

Date: 2026-07-30

## DEC-004: One-Shot Migrator

Decision: API and worker containers no longer run migrations at startup. `lead-core-migrate` is the one-shot migration container, and `scripts/migrate.ts` uses a PostgreSQL advisory lock plus SHA-256 migration checksums.

Reason: Startup migrations from multiple long-running services can race and cannot detect modified applied SQL.

Date: 2026-07-30

## DEC-005: Vitest Upgrade

Decision: Upgrade Vitest to the latest resolved major version in the lockfile.

Reason: The initial lockfile generation exposed critical/high audit findings in the older Vitest/Vite dev-tool chain. The upgrade produced zero `npm audit` findings and tests remained green.

Date: 2026-07-30

## DEC-006: Codex Repository Instructions

Decision: Replace Claude-specific repository instruction files with root `AGENTS.md`.

Reason: The repository is now operated with Codex. Durable instructions must be discoverable by Codex without relying on Claude Code conventions.

Date: 2026-07-30

## DEC-007: Importer Requires Stable Source IDs

Decision: Reject Airtable rows that do not include a stable record ID instead of synthesizing one from content and row position.

Reason: Synthetic IDs are not stable across exports and would corrupt idempotency/entity mapping guarantees.

Date: 2026-07-30

## DEC-008: Readiness Requires Migration Completeness

Decision: `/ready` compares applied migration rows against migration files on disk and fails if any migration is missing.

Reason: A database connection plus latest-row display does not prove the required schema is present.

Date: 2026-07-30

## DEC-009: Runtime Worker Handler Boundary

Decision: Introduce the durable runtime worker with injectable inbox, outbox, and scheduled-job handlers, and keep it disabled unless real handlers are configured.

Reason: MP-04 owns durable queue semantics, leases, retries, and audit history. Provider-specific dispatch and business processors belong to later MPs; the worker must not fake successful production side effects while those adapters are disabled.

Date: 2026-07-30

## DEC-010: Meta Adapter Disabled By Default

Decision: Add the Meta WhatsApp adapter behind an explicit enabled configuration and classify provider outcomes from real response shapes instead of returning hardcoded success.

Reason: Live Meta credentials and template approvals are pending owner action. The code can be contract-tested with sanitized fixtures, but production must not send or pretend to send messages until credentials, templates, and staging webhooks are verified.

Date: 2026-07-30

## DEC-011: Conversation Configuration Pins

Decision: Store `configuration_version_id` on legacy `edge_conversations` in addition to the existing `config_version` text key, and only re-pin an existing conversation through the explicit bootstrap `migrateConfig` path.

Reason: Conversations must remain pinned to the configuration they started with during cutover, while operators still need a deliberate compatibility path to move a legacy conversation onto a newer immutable published configuration.

Date: 2026-07-30

## DEC-012: Airtable Configuration Export Validation

Decision: Compile Airtable configuration exports only from the verified Questions, Question Options, and Conversation Messages field names, require stable Airtable record IDs, normalize CSV booleans and linked-record fields, and reject malformed rows before publishing.

Reason: The real Airtable export is unavailable. Local parity can be proven against sanitized Airtable-shaped exports, but production configuration authority must not be published from rows with missing IDs, duplicate IDs, invalid active flags, missing links, or missing display text.

Date: 2026-07-30

## DEC-013: Edge Inbound Conversation Ownership Gate

Decision: Durable Meta inbound message processing only mutates conversations whose `conversation_engine` and `state_authority` are both `edge`; legacy-owned conversations are durably acknowledged and ignored so Typebot remains authoritative during cutover.

Reason: The migration must preserve rollback/fallback paths until explicit cutover evidence exists. Processing legacy-owned turns in Edge would create duplicate authorities for conversation state and outbound replies.

Date: 2026-07-30

## DEC-014: Durable Opt-Out Suppresses Outbound Replies

Decision: Durable inbound processing records explicit WhatsApp opt-outs as a no-reply state transition, updates Edge/app control state, and does not enqueue an outbound confirmation message.

Reason: Once a lead has explicitly opted out, the safest durable behavior is to stop all outbound side effects immediately. Any future opt-out confirmation policy must be explicitly configured and verified against provider/legal requirements before sending.

Date: 2026-07-30

## DEC-015: Calendar Delivery State Is Appointment Authority

Decision: Marking a `calendar.create_event` outbox command delivered persists the provider calendar event ID onto the linked `app.appointments` row and confirms the appointment; delivery-unknown calendar creates remain in `runtime.outbox_commands.state='delivery_unknown'` and are not automatically replayed.

Reason: Provider acceptance may have occurred even if the worker crashed before recording the provider ID. Automatic replay could create duplicate calendar events, so ambiguous creates require operator-visible reconciliation while preserving the original payload and attempt history.

Date: 2026-07-30

## DEC-016: Calendar Failure Reconciliation Does Not Release Bookings

Decision: Operator reconciliation of a delivery-unknown calendar create that is verified as not created marks the durable outbox command permanently failed and records audit/dead-letter evidence, but leaves the linked appointment in `booked` state without a provider event ID.

Reason: The customer booking remains real local business state even when the external calendar side effect failed. Releasing or changing appointment semantics would require a broader rescheduling/cancellation policy and could create a second authority for the same slot.

Date: 2026-07-30

## DEC-017: Direct Ingress Requires Explicit Enablement

Decision: Direct Meta webhook receipt and direct website/Facebook lead ingress are disabled by default behind `DIRECT_META_WEBHOOK_ENABLED` and `DIRECT_LEAD_INGRESS_ENABLED`, while n8n compatibility remains independently controlled by `N8N_COMPAT_ROUTES_ENABLED`.

Reason: MP-12 must preserve fallback infrastructure during cutover and avoid accidental direct-provider activation from merely deploying the edge app with secrets present. Direct ingress should become reachable only through an explicit environment and routing change.

Date: 2026-07-30

## DEC-018: Cutover Readiness Is Read-Only

Decision: The MP-12 cutover readiness command reports direct-route flags, fallback compatibility, inbox/outbox/due scheduled-job backlog, delivery-unknowns, dead letters, and runtime heartbeat age without claiming, retrying, replaying, cancelling, or mutating any durable runtime row.

Reason: Cutover checks must be safe to run repeatedly in staging and production. Operational repair actions belong to explicit reconciliation/replay commands with separate operator intent.

Date: 2026-07-30

## DEC-019: Deployment Verification Uses Synthetic Direct-Ingress Checks

Decision: Deployment verification may probe direct Meta challenge and direct lead ingress route state with synthetic requests against a supplied staging base URL, but it must not send real customer messages or mutate external provider accounts.

Reason: MP-12 needs repeatable route-state evidence before Caddy/DNS cutover. Synthetic route checks prove enabled/disabled behavior while preserving rollback paths and avoiding customer-facing side effects.

Date: 2026-08-01

## DEC-020: Decommission Readiness Is Approval-Gated

Decision: Decommission readiness is implemented as a read-only PostgreSQL report with explicit owner-evidence flags for final exports, migrated appointment/media paths, projection-only Airtable operation, and per-area decommission approvals.

Reason: n8n, Typebot, and Airtable removal is destructive and externally visible. The repository can prove local exit conditions and surface blockers, but it must not infer owner approval or delete fallback infrastructure from local metrics alone.

Date: 2026-08-01

## DEC-021: Historical Airtable Events Import Into Audit

Decision: Import Airtable `Events` rows as historical `audit.events` records with actor type `migration`, preserve source identity in `migration.entity_map`, redact secret-like keys from the audit payload summary, and append a new audit row only when a previously mapped source event changes.

Reason: The existing n8n audit workflow proves the Events field contract, but `audit.events` is append-only and must not become a mutable duplicate authority. Reconciliation must verify source-to-target mapping while preserving audit immutability and secret hygiene.

Date: 2026-08-01

## DEC-022: Runtime Worker Is A First-Class Deployable Container

Decision: Compose runs the durable runtime worker as `lead-core-runtime-worker` with `WORKER_KIND=runtime`, separate from the legacy `edge_outbox` compatibility worker, and `/ready` checks enabled outbox/runtime worker heartbeats independently.

Reason: MP-04 and later durable inbox, runtime outbox, and scheduled job processing must be deployable without overloading the legacy n8n compatibility outbox path. Keeping both workers explicit preserves rollback while letting staging fail readiness when an enabled worker is not actually alive.

Date: 2026-08-01

## DEC-023: Legacy Active-Turn Compatibility Gate

Decision: The legacy synchronous `/v1/turn` route is disabled by default behind `ACTIVE_TURN_COMPAT_ENABLED`; direct Meta ingress must use the durable inbox path unless an operator deliberately enables legacy compatibility.

Reason: `/v1/turn` preserves rollback compatibility for the original active edge path, but it predates the durable outbox architecture and sends through the old synchronous Meta path. Keeping it opt-in prevents accidental reintroduction of in-transaction external sends or legacy fallback behavior during cutover.

Date: 2026-08-01

## DEC-024: Legacy Edge Outbox Has A Terminal Failure State

Decision: The legacy `edge_outbox` compatibility queue now marks rows `dead_lettered` after five delivery attempts instead of retrying indefinitely.

Reason: The durable runtime outbox is the target architecture, but the legacy compatibility worker may still be deliberately enabled during rollback. Bounded retry with an operator-visible terminal state prevents runaway compatibility retries while preserving the row for decommission readiness and manual inspection.

Date: 2026-08-01

## DEC-025: Cutover Reports Surface Legacy Active-Turn Compatibility

Decision: Cutover readiness fails when `ACTIVE_TURN_COMPAT_ENABLED=true`, and decommission readiness includes `active_turn_compat_disabled` before n8n/Typebot fallback can be considered removable.

Reason: The legacy active-turn route is intentionally preserved as a rollback switch, but it must not be invisible in cutover evidence. Operator reports should prevent accidental promotion or decommission while the old synchronous send path is enabled.

Date: 2026-08-01

## DEC-026: Direct Lead Deployment Probes Avoid Business Lead Creation

Decision: `scripts/verify-deployment.sh --check-direct-lead --expect-direct-lead=enabled` uses deliberately incomplete website and Facebook lead payloads and expects durable HTTP acknowledgement from the route instead of posting complete synthetic leads.

Reason: MP-12 route-state verification should prove the direct lead routes are enabled and can durably receipt webhook payloads without creating authoritative `app.leads`, `app.contacts`, follow-up jobs, or outbound commands inside the request. Payload validation and business processing belong to the runtime worker, so any resulting ignored inbox rows are acceptable staging evidence and must not be treated as business leads.

Date: 2026-08-01

## DEC-027: Request Logs Redact Query Secrets

Decision: Fastify/Pino request logging redacts sensitive query parameters, including Meta `hub.verify_token`, and authentication headers before logs are emitted.

Reason: Direct webhook verification uses provider-defined query parameters and headers that can contain credential or signature material. Logs must preserve route and status evidence without printing reusable secrets.

Date: 2026-08-01

## DEC-028: Deployment Verifier Keeps Secrets Out Of Process Arguments

Decision: `scripts/verify-deployment.sh` keeps sourced environment values shell-local, writes shared-secret HTTP headers to private temporary files, and passes the Meta challenge URL through a private curl config file instead of putting secret values directly in curl arguments or child-process environments.

Reason: Staging verification can run on shared hosts or under process monitors. Secrets in command-line arguments or exported child-process environments are observable via process tooling, while temporary files scoped to the verifier process reduce exposure and are deleted by the script cleanup trap.

Date: 2026-08-01

## DEC-029: Operator Scripts Keep Connection Secrets Out Of Process Arguments

Decision: Shell operator scripts must not pass shared secrets or password-bearing PostgreSQL URLs directly to child process command arguments. Shadow verification writes `EDGE_SHARED_SECRET` to a private curl header file, and backup/restore scripts convert database URLs into private libpq service files before invoking `pg_dump`, `psql`, or `pg_restore`.

Reason: Backup, restore, and shadow verification are likely to run on operator hosts where process listings may be available to monitoring tools or other users. Private temporary files with cleanup traps reduce exposure while preserving normal PostgreSQL and curl behavior.

Date: 2026-08-01

## DEC-030: Calendar Network Errors Preserve Replay Safety

Decision: Google Calendar free/busy network failures are classified as retryable, create-event network failures are classified as `delivery_unknown`, and numeric or HTTP-date `Retry-After` hints are parsed with a one-hour cap.

Reason: Free/busy checks happen before attempting an external calendar mutation and can be retried safely. A network failure during event creation may have occurred after Google accepted the request, so the durable outbox must preserve ambiguity for operator reconciliation instead of blindly creating a second event. Provider retry hints should be respected without allowing an unbounded provider value to hide stuck work indefinitely.

Date: 2026-08-01

## DEC-031: Generated Env Secrets Stay Out Of Process Arguments

Decision: `scripts/generate-env.sh` writes generated local database and service secrets to private temporary files, unsets the shell variables, and passes only temporary file paths to Python when rendering `.env`.

Reason: Even locally generated secrets are reusable credentials once written to `.env`. Passing them through child-process arguments exposes them to process-listing and command-capture tooling, while private temporary files preserve the one-command developer setup path without printing or exporting secret values.

Date: 2026-08-01

## DEC-032: Runtime Retries Use Bounded Jitter

Decision: Runtime inbox, outbox, and scheduled-job retries use bounded exponential backoff with random jitter when no provider retry hint is supplied; provider `Retry-After` hints remain exact inputs capped at one hour.

Reason: Deterministic retry spacing can concentrate recovered worker traffic after provider or database incidents. Jitter reduces retry herd behavior while preserving the existing upper bound and honoring explicit provider rate-limit guidance.

Date: 2026-08-01

## DEC-033: Enabled Integrations Require Startup Credentials

Decision: Environment validation rejects enabled external integration modes unless the required local configuration is present: legacy outbox target URL/secret, direct Meta webhook verify/app secrets, direct Meta send access token/phone ID, active-turn compatibility backed by direct Meta send, and Google Calendar access token.

Reason: Disabled integrations must remain safely configurable without credentials during cutover, but enabling an integration with missing credentials turns deployment mistakes into runtime dead letters, failed webhook receipts, or synchronous legacy send failures. Startup validation gives operators a deterministic failure before traffic is routed.

Date: 2026-08-01

## DEC-034: Invalid Scheduled Jobs Dead-Letter Immediately

Decision: Runtime scheduled-job processors may return a permanent `dead_lettered` outcome, and malformed durable job payloads use that path instead of retrying until maximum attempts.

Reason: A malformed job payload is not a transient provider or database failure. Retrying it wastes worker capacity and delays operator-visible evidence, while direct dead-lettering preserves the original payload and attempt history for investigation.

Date: 2026-08-01

## DEC-035: Recurring Daily Reports Materialize One Occurrence At A Time

Decision: A successful `report.daily` worker transaction marks the current report sent, enqueues the operator report outbox command, and schedules exactly the next semantic daily report/job for the client in the same PostgreSQL transaction. The next due time preserves the client-local clock time in the configured timezone, so UTC due times shift across daylight-saving transitions.

Reason: `runtime.scheduled_jobs.recurrence_json` is configuration metadata, not a durable scheduling authority by itself. Materializing one next occurrence at completion keeps recurrence restart-safe and idempotent without in-process timers, duplicate daily jobs, or an unbounded pre-generated queue.

Date: 2026-08-01

## DEC-036: Decommission Stability Requires Processed Direct Ingress

Decision: `npm run decommission:readiness` counts only aged direct `runtime.inbox_events` with `status='processed'` as direct-ingress stability evidence. Ignored direct-ingress deployment probes remain useful route-check evidence, but they do not satisfy fallback-removal stability criteria.

Reason: Staging route checks intentionally use incomplete payloads that can produce ignored durable receipts after worker validation without creating business state. Counting those receipts as stability evidence would allow synthetic probes to justify n8n/Typebot/Airtable decommission, contradicting the requirement not to claim production readiness from synthetic fixtures.

Date: 2026-08-01

## DEC-037: Cutover Readiness Includes Due Scheduled Jobs

Decision: `npm run cutover:readiness` treats due or processing `runtime.scheduled_jobs` as runtime backlog alongside inbox and outbox work. Future scheduled jobs are not counted as pending cutover backlog.

Reason: Scheduled jobs are part of the durable PostgreSQL runtime authority. Route cutover should not proceed with abandoned due follow-up, SLA, report, or appointment work, but legitimate future schedules must not block direct-ingress readiness.

Date: 2026-08-01

## DEC-038: Worker Heartbeats Must Be Operational

Decision: `/ready` and `npm run cutover:readiness` require fresh worker heartbeats to include metadata proving the required worker is operational. A runtime heartbeat must have `enabled=true` and at least one configured handler; a legacy outbox heartbeat must have both worker enablement and target configuration metadata before it satisfies required-worker readiness.

Reason: A disabled worker process can still emit a fresh heartbeat while intentionally not claiming durable work. Treating that as ready would allow cutover with no active runtime processor even when `RUNTIME_WORKER_ENABLED=true`.

Date: 2026-08-01

## DEC-039: Direct Lead Webhooks Acknowledge Durable Receipt Only

Decision: Direct website and Facebook lead webhook routes authenticate, gate, store the raw payload in `runtime.inbox_events`, deduplicate by provider identity or deterministic fallback hash, and return acknowledgement without running lead intake business logic. A runtime inbox processor claims only configured website/Facebook lead event providers and types, validates payloads, ignores permanent bad inputs, retries transient failures, and calls `LeadIntakeService` outside the HTTP request path.

Reason: The target architecture separates durable receipt from business processing. Running lead intake in the webhook request could create customer state, outbox commands, and projection work before the external provider acknowledgement returned, and made deployment probes depend on synchronous validation instead of durable inbox evidence.

Date: 2026-08-01

## DEC-040: Direct Ingress Requires Runtime Worker Configuration

Decision: Enabling direct website/Facebook lead ingress requires `RUNTIME_WORKER_ENABLED=true`. Enabling direct Meta webhook ingress requires `RUNTIME_WORKER_ENABLED=true` and `META_STATUS_PROCESSOR_ENABLED=true`. Startup validation rejects direct route flags without the worker path that can process the corresponding durable inbox receipts.

Reason: A direct webhook route that can acknowledge durable receipt while no runtime worker is configured would create an unbounded pending inbox and false cutover confidence. Readiness still verifies fresh operational heartbeats, but startup validation should catch impossible direct-ingress configurations before traffic is routed.

Date: 2026-08-01

## DEC-041: Delivery Status Processing Is Monotonic

Decision: Meta/n8n WhatsApp delivery-status processing records every distinct provider status event, but `app.messages.state` only advances according to delivery lifecycle precedence. Older `sent` or `delivered` events received after `read` are preserved as delivery events and audit evidence without regressing the current message state.

Reason: Provider webhooks can arrive out of order. Reporting, cutover readiness, and operator reconciliation need the complete provider event trail, while the authoritative message state should represent the furthest known delivery outcome rather than the last webhook arrival order.

Date: 2026-08-01

## DEC-042: Decommission Stability Counts Business Ingress Only

Decision: Direct-ingress stability evidence for decommission readiness counts only processed business ingress events: direct Meta inbound messages and direct website/Facebook lead events. Direct provider status callbacks remain retained as runtime evidence, but they do not satisfy n8n/Typebot fallback-removal stability.

Reason: Delivery-status callbacks prove provider reporting, not that customer/lead ingress has been safely handled by Edge-owned business processing for the required stability window. Counting status callbacks could let synthetic or incidental provider events satisfy decommission criteria without real direct intake or conversation evidence.

Date: 2026-08-01

## DEC-043: API Startup Must Not Seed Configuration

Decision: The production API container starts with `npm start` only. Database migrations and configuration seed/publish operations remain explicit operator or migrator actions, not normal API startup side effects.

Reason: Configuration is versioned, audited, and separately published from executable code. Even an idempotent seed step mutates PostgreSQL from the API startup path and can blur deployment, rollback, and configuration authority during cutover.

Date: 2026-08-01

## DEC-044: Production Build Excludes Tests

Decision: `npm run build` uses `tsconfig.build.json` to clean `dist` and compile only runtime source and scripts. `npm run lint` continues typechecking tests through the main `tsconfig.json`, and the Docker build stage no longer copies the test tree.

Reason: Tests should remain strictly typechecked and runnable locally, but production build artifacts and images should contain deployable runtime code, operational scripts, config, and migrations rather than compiled test code.

Date: 2026-08-01

## DEC-045: Unsupported Meta Webhooks Are Worker-Ignored Receipts

Decision: Signed Meta webhook payloads that contain no supported status or inbound message events are still durably receipted, then claimed by the runtime Meta inbox processor and marked `ignored` with an operator-visible reason. Cutover readiness requires runtime heartbeat metadata to include this ignored-webhook event type when direct Meta ingress is enabled.

Reason: Durable receipt should acknowledge valid provider delivery without synchronous business processing, but unsupported signed payloads must not remain permanently pending. Explicit worker-owned ignore handling preserves receipt evidence and keeps inbox backlog/readiness meaningful.

Date: 2026-08-01

## DEC-046: N8n Callback Routes Receipt Before Relationship Resolution

Decision: n8n-compatible inbound callbacks for WhatsApp status acknowledgements, inbound WhatsApp messages, and salesperson commands authenticate, validate event shape, and write the durable inbox receipt before resolving client relationships. Worker processors own missing-message, missing-channel, and missing-client outcomes. The n8n-compatible outbound send route still resolves the client synchronously because it is an internal request to create a new side effect, not an inbound event receipt.

Reason: Compatibility callbacks are external event ingress during cutover. Unknown or stale relationships must be visible as durable runtime evidence and operator-visible worker outcomes, not lost as pre-receipt HTTP 404 responses.

Date: 2026-08-01

## DEC-047: Readiness CLI Arguments Fail Closed

Decision: Cutover and decommission readiness CLI wrappers reject unknown arguments and malformed numeric threshold arguments before querying PostgreSQL.

Reason: Operator readiness commands are promotion and decommission evidence. Silently ignoring a typoed threshold or owner-evidence flag can make an execution record look stricter than the command actually was.

Date: 2026-08-01

## DEC-048: Decommission Requires Current Direct-Ingress Authority

Decision: `npm run decommission:readiness` requires direct ingress to be currently enabled with the runtime worker enabled before n8n fallback removal can pass, in addition to aged processed direct business-ingress evidence.

Reason: Historical processed direct-ingress rows prove past behavior only. Fallback removal must not pass when the current environment is no longer routing business ingress through Edge-owned durable processing.

Date: 2026-08-01

## DEC-049: Decommission Requires Operational Direct-Ingress Worker Metadata

Decision: `npm run decommission:readiness` requires a fresh operational runtime worker heartbeat whose metadata advertises the inbox providers and event types for every currently enabled direct-ingress route.

Reason: Enabled route flags do not prove that durable worker processing is currently active. Fallback removal must not pass if Edge can receive direct ingress but no worker is proving ownership of the matching business processors.

Date: 2026-08-01

## DEC-050: Decommission Stability Must Match Enabled Direct-Ingress Families

Decision: `npm run decommission:readiness` evaluates direct-ingress stability by currently enabled route family. Enabled direct Meta ingress requires aged processed Meta inbound-message evidence, and enabled direct lead ingress requires aged processed website or Facebook lead evidence.

Reason: Aged direct activity from one ingress family does not prove another enabled direct route has safely replaced legacy fallback authority.

Date: 2026-08-01

## DEC-051: N8n Dead Letters Block Decommission

Decision: `npm run decommission:readiness` counts dead-lettered n8n inbox events as unresolved n8n compatibility work until they are explicitly replayed, ignored, or otherwise resolved by an operator-approved path.

Reason: A dead-lettered compatibility callback is not active backlog, but it is unresolved migration evidence. Fallback removal must not hide dead-lettered n8n ingress that may require reconciliation before retirement.

Date: 2026-08-01

## DEC-052: Deployment Verifier Uses Signed Non-Customer Meta Probe

Decision: `scripts/verify-deployment.sh --check-direct-meta --expect-direct-meta=enabled` verifies both the Meta challenge route and a signed non-customer webhook POST that should produce durable receipt acknowledgement. The probe payload contains no customer message/status data and exercises the `whatsapp.webhook_ignored` durable receipt path.

Reason: Challenge verification alone proves only URL/token reachability. Direct Meta cutover also depends on signature handling and durable POST receipt before business processing.

Date: 2026-08-01

## DEC-053: Rejected N8n Salesperson Commands Block Decommission

Decision: `npm run decommission:readiness` counts rejected n8n salesperson command rows as unresolved n8n compatibility work even when their inbox receipt has already been processed.

Reason: Inbox processing proves durable receipt handling, but a rejected command proves compatibility traffic failed business-authority validation. Fallback removal should not hide those command outcomes before operator reconciliation.

Date: 2026-08-01

## DEC-054: Parked Legacy Edge Outbox Rows Block Decommission

Decision: `npm run decommission:readiness` treats legacy `edge_outbox.status='parked'` rows as unresolved n8n compatibility work alongside pending, processing, failed, and dead-lettered rows.

Reason: Parked outbox rows are retained shadow-rollout side-effect records, not delivered or explicitly cancelled effects. Fallback removal should require an operator-visible disposition for those rows before n8n compatibility infrastructure is retired.

Date: 2026-08-01

## DEC-055: Cancelled Airtable Projection Commands Block Decommission

Decision: `npm run decommission:readiness` treats cancelled `airtable.project_lead_visibility` outbox commands as incomplete Airtable projection evidence.

Reason: A cancelled projection command is a terminal durable outbox state, but it is not evidence that the read-only Airtable visibility projection was delivered. Airtable retirement should require delivered projection work or separate reconciliation evidence that removes the cancelled command from the projection queue.

Date: 2026-08-01

## DEC-056: Historical N8n Delivery Status Outcomes Do Not Extend The Decommission Window

Decision: `npm run decommission:readiness` blocks on unresolved n8n delivery-status inbox rows and on any n8n compatibility callback inside the configured stability window, but it does not add an unbounded blocker for older processed n8n delivery-status outcomes such as `failed` or unknown provider statuses.

Reason: A processed n8n delivery-status callback is retained delivery/reporting evidence, not durable fallback authority by itself. Failed or unknown delivery outcomes remain visible through message state, delivery events, reports, and audit records; turning every historical negative delivery status into a decommission blocker would make fallback retirement depend on an unrelated customer-remediation policy rather than on whether n8n still owns ingress, scheduling, or side-effect delivery.

Date: 2026-08-01

## DEC-057: Direct Meta Deployment Verification Includes Signature Rejection

Decision: `scripts/verify-deployment.sh --check-direct-meta` verifies direct Meta challenge and POST behavior for the expected route state. When enabled, it proves challenge handling, signed durable receipt, and unsigned POST rejection. When disabled, it proves both challenge and POST return unavailable.

Reason: A deployment can accept signed Meta probes while still accidentally accepting unsigned provider traffic if signature enforcement regresses. The staging verifier should prove both the positive and negative signature paths before route changes are treated as verified.

Date: 2026-08-01

## DEC-058: Disabled Direct-Ingress Verification Does Not Require Secrets

Decision: Disabled direct Meta and direct website/Facebook lead ingress routes return HTTP 503 before provider token, signature, or shared-secret validation. `scripts/verify-deployment.sh` therefore requires `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, and `EDGE_SHARED_SECRET` only for enabled direct-route verification paths that actually need those credentials.

Reason: Missing rotated provider credentials or internal route secrets should not block proof that a direct ingress route family is disabled and unavailable. Enabled route verification still requires the appropriate credentials and proves authentication or signature enforcement before cutover.

Date: 2026-08-01

## DEC-059: N8n Compatibility Inbox Processing Is Independent Of Direct Meta Enablement

Decision: The runtime worker wires the shared WhatsApp/status/salesperson inbox processor when either `META_STATUS_PROCESSOR_ENABLED=true` or `N8N_COMPAT_ROUTES_ENABLED=true`. Direct website/Facebook lead processors remain gated only by `DIRECT_LEAD_INGRESS_ENABLED=true`.

Reason: n8n-compatible callback routes durably receipt WhatsApp status, inbound message, and salesperson command events while fallback infrastructure remains active. Those rows must remain processable even when direct Meta webhook ingress is disabled for cutover staging or rollback.

Date: 2026-08-01

## DEC-060: N8n Compatibility Requires Runtime Worker Readiness

Decision: `N8N_COMPAT_ROUTES_ENABLED=true` requires `RUNTIME_WORKER_ENABLED=true` at startup, and `npm run cutover:readiness` fails unless the latest operational runtime worker heartbeat advertises the n8n inbox provider and the WhatsApp status, inbound message, and salesperson command event types.

Reason: n8n compatibility routes are fallback infrastructure, but their callback routes are still durable external event ingress. A deployment that accepts n8n callbacks without a runtime worker able to process those inbox rows would create hidden backlog and false cutover confidence.

Date: 2026-08-01

## DEC-061: Deployment Verifier Checks N8n Fallback Availability

Decision: `scripts/verify-deployment.sh --check-n8n-compat` verifies the expected n8n compatibility fallback state using an authenticated, non-customer inbound-message probe. Enabled checks require durable receipt acknowledgement, while disabled checks require authenticated HTTP 503 unavailability.

Reason: MP-12 staging evidence must prove fallback routes remain available during direct-ingress cutover, or are intentionally unavailable after approval, without relying on live customer traffic. The n8n compatibility routes are internal routes, so the verifier must prove their behavior with `EDGE_INTERNAL_SECRET` while keeping that secret out of command-line arguments.

Date: 2026-08-01

## DEC-062: N8n Decommission Requires Compatibility Routes Disabled

Decision: `npm run decommission:readiness` fails n8n readiness while `N8N_COMPAT_ROUTES_ENABLED=true`, even when no recent or unresolved n8n inbox rows remain and direct ingress has stable processed evidence.

Reason: An enabled compatibility route is still fallback ingress authority. n8n removal readiness must prove that Edge is no longer intentionally accepting n8n-compatible callbacks before fallback infrastructure can be considered removable.

Date: 2026-08-01

## DEC-063: Rejected Airtable Rows Block Final Reconciliation

Decision: Airtable reconciliation treats rejected source rows as failed reconciliation evidence for final readiness, while mapped-count checks compare accepted source rows to target mappings and record raw, rejected, and accepted counts in check details.

Reason: A rejected row is not proof of successful migration and must be resolved before Airtable can be retired. At the same time, correctly rejected rows should not distort per-entity mapping checks by appearing as missing target rows.

Date: 2026-08-01

## DEC-064: Airtable Business Reconciliation Uses Accepted Source Mappings

Decision: Airtable business reconciliation checks for lead status distribution, active lead counts, stop-follow-up counts, pending follow-ups, open/booked appointments, and imported message provider-ID uniqueness compare accepted source records joined through `migration.entity_map` to the corresponding PostgreSQL target rows.

Reason: These checks must prove that imported Airtable rows landed in the correct business state without treating unrelated target rows as evidence. Rows that could not be mapped remain visible through reject and mapping failures instead of being silently inferred.

Date: 2026-08-01

## DEC-065: Airtable Contact Opt-Out Preservation

Decision: The Airtable importer preserves contact opt-out state from accepted Lead rows when `Consent Status` is `opted_out`, `opted out`, `unsubscribed`, `withdrawn`, `revoked`, or `no_consent`, or when `Opted Out` is `true`, `yes`, or `1`. Reconciliation compares accepted source opt-out counts to imported `app.contacts.opted_out` rows.

Reason: Opt-out state is durable business state, not display-only metadata. The importer already preserves the raw consent status text; setting the boolean prevents follow-up and messaging workflows from losing suppression state during the PostgreSQL authority transition.

Date: 2026-08-01

## DEC-066: Airtable Decommission Requires Complete Reconciliation Suite

Decision: `npm run decommission:readiness` requires every currently required Airtable reconciliation check key to have recorded evidence, and it still fails if any recorded reconciliation result is not `pass`.

Reason: Airtable removal cannot be justified by a single passing reconciliation row or an incomplete subset of checks. Final decommission readiness must prove the full local reconciliation suite was run and passed before owner approval can be meaningful.

Date: 2026-08-01

## DEC-067: Cutover Readiness Requires A Direct Ingress Target

Decision: `npm run cutover:readiness` fails unless at least one direct-ingress route family is selected through `DIRECT_META_WEBHOOK_ENABLED=true` or `DIRECT_LEAD_INGRESS_ENABLED=true`.

Reason: n8n compatibility and empty queues are useful fallback and operational evidence, but they do not prove Edge is ready to receive direct provider traffic. Operators must enable the approved direct route and required runtime worker flags before using cutover readiness as route-change evidence.

Date: 2026-08-01

## DEC-068: Terminal Runtime Outbox Failures Block Cutover

Decision: `npm run cutover:readiness` fails when any `runtime.outbox_commands` row is in `permanently_failed` or `dead_lettered` state, independent of whether a corresponding `runtime.dead_letters` row exists.

Reason: A terminal external-effect failure is unresolved operational state that can affect customer messaging, calendar side effects, reporting, or fallback reconciliation. Cutover readiness should not depend on secondary dead-letter evidence alone when the authoritative outbox row already records a terminal failure.

Date: 2026-08-01

## DEC-069: Decommission Stability Uses Processing Completion Time

Decision: `npm run decommission:readiness` measures direct-ingress stability from `runtime.inbox_events.completed_at`, not from receipt `created_at`, for processed direct Meta inbound-message and website/Facebook lead events.

Reason: Durable receipt proves the event was safely acknowledged, but fallback removal requires proof that Edge-owned processing has been stable for the full window. An old receipt that only completed processing recently must not justify n8n/Typebot decommission.

Date: 2026-08-01

## DEC-070: Recent Legacy Conversation Activity Blocks Decommission

Decision: `npm run decommission:readiness` fails n8n and Typebot readiness when a legacy-owned conversation has recent activity inside the stability window, measured from `GREATEST(created_at, updated_at, last_inbound_at)`.

Reason: A legacy conversation can be older than the window and no longer resumable while still having been handled recently by legacy/Typebot authority. Fallback removal should require a quiet legacy window, not only absence of newly created or currently active legacy conversations.

Date: 2026-08-01

## DEC-071: Active Legacy Config Snapshots Must Be Versioned Before Typebot Removal

Decision: `npm run decommission:readiness` fails Typebot readiness when an active `edge_config_snapshots` row has no matching published `configuration.versions` row with the same version key.

Reason: Typebot removal requires all live conversation content authority to be present in immutable versioned configuration. The legacy snapshot table remains as a rollback compatibility path, but an active snapshot without a published immutable version is still legacy-only content evidence.

Date: 2026-08-01

## DEC-072: Typebot Qualification Volume Counts Edge-Owned Sessions Only

Decision: `npm run decommission:readiness` counts completed Edge qualification volume only from `app.qualification_sessions` rows linked to matching `app.conversations` rows whose projected state came from `edge_conversations` with `stateAuthority='edge'`.

Reason: Imported historical qualification sessions and detached synthetic rows can prove migration history, but they do not prove real Edge-owned conversation processing has replaced Typebot. Typebot removal readiness must measure successful Edge-owned qualifications, not all completed qualification rows.

Date: 2026-08-01
