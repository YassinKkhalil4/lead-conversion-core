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

Decision: The MP-12 cutover readiness command reports direct-route flags, fallback compatibility, queue backlog, delivery-unknowns, dead letters, and runtime heartbeat age without claiming, retrying, replaying, cancelling, or mutating any durable runtime row.

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
