# Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness, resilience and structural defects found in the 2026-09-27 backend audit without changing any public API contract.

**Architecture:** The service is a Fastify + PostgreSQL modular monolith. Durable inbox, outbox and scheduled-job tables are claimed by a single runtime worker with leases. Every fix below keeps that shape: no new infrastructure, no new dependencies, additive changes only, and no migration edits.

**Tech Stack:** Node 22, TypeScript (strict, `exactOptionalPropertyTypes`), Fastify 5, `pg`, Zod, Vitest 4. Integration tests start a disposable PostgreSQL cluster per file through `initdb`/`pg_ctl`.

**Spec:** Audit findings below. This plan is its own spec.

## Global Constraints

- No schema migrations are edited; any schema change is a new additive migration (none are expected).
- No new runtime dependencies.
- No external HTTP call inside a database transaction.
- Idempotency keys stay deterministic; never `Date.now()` or random.
- Public responses never echo raw internal errors.
- Gate before each commit: `npm run lint && npm test && npm run build`.

## Audit Findings

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| F1 | High | Inbox/outbox/job finalizers update by id only. A worker whose lease expired mid-dispatch still finalizes the row after another worker reclaimed it, overwriting the newer attempt's state and attributing the outcome to the wrong attempt row. A replay issued during processing is silently undone. | `src/infrastructure/runtime.ts` |
| F2 | High | Opt-out detection is a substring match. "nonstop", "stopover", "موقف" (parking) and "بلوك 3" (building block 3) all opt a lead out and end the conversation. | `src/services/edge-inbound-message-processor.ts:69` |
| F3 | High | Any exception escaping `tick()` (a heartbeat blip, a failed claim, a failed finalizer) rejects `run()`, and the process exits. | `src/worker/runtime-worker.ts` |
| F4 | Medium | Shutdown calls `worker.stop()` then closes the pool immediately; an in-flight dispatch fails against an ended pool after the provider may already have accepted the send. | `src/worker-runner.ts` |
| F5 | Medium | `withTransaction` and 36 hand-rolled `BEGIN/COMMIT/ROLLBACK` blocks: a failing `ROLLBACK` replaces the real error and returns a broken connection to the pool. | `src/db/transaction.ts` and callers |
| F6 | Medium | Outbox routing falls through to the WhatsApp dispatcher for unknown command types; with sending disabled an unknown type reports `messaging_dispatcher_disabled`. Routing is untestable module-level code. | `src/worker-runner.ts` |
| F7 | Medium | SSE stream: a failed LISTEN connect leaks the subscriber and leaves a hijacked socket open; the stream never re-validates its session, so a revoked or deactivated user keeps receiving events. | `src/services/dashboard/stream-service.ts`, `src/routes/dashboard/stream.ts` |
| F8 | Medium | Consumer-receipt lease is judged with the app clock (`Date.now()`) against a DB timestamp; skew double-grants a lease. SQL lives in the route handler. | `src/routes/internal.ts` |
| F9 | Low | `/ready` is unauthenticated and returns `String(error)` from the driver. | `src/routes/health.ts` |
| F10 | Low | Dead code: `MetaSender` is unreferenced and bypasses the outbox. Duplicates: `type Db` ×13, `publicHeaders`/`rateLimitConfig` ×3, WhatsApp message schema ×2. | various |

Out of scope (recorded, not fixed): `markDelivered` writes `app.messages`/`app.appointments` from the infrastructure layer; moving it needs a delivery-effects seam and is a larger change than this pass.

---

### Task 1: Transaction helper and shared `Db` type (F5, F10)

**Files:**
- Modify: `src/db/transaction.ts`
- Modify: `src/db/pool.ts` (export `Db`)
- Modify: the 13 files that redeclare `type Db`
- Test: `tests/db-transaction.test.ts`

**Interfaces:**
- Produces: `export type Db = Pool | PoolClient` from `src/db/pool.ts`; `withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing test** (`tests/db-transaction.test.ts`): mock `../src/db/pool.js` with a fake pool whose client throws on `ROLLBACK`. Assert the original error propagates and `release` is called with a truthy argument (connection destroyed). Second case: success path commits and releases with no argument.
- [ ] **Step 2:** `npx vitest run tests/db-transaction.test.ts` → FAIL (rollback error masks original).
- [ ] **Step 3: Implement**

```ts
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
```

- [ ] **Step 4:** Replace every local `type Db = typeof pool | PoolClient` with `import type { Db } from '<rel>/db/pool.js'`. Run `npm run lint` → PASS.
- [ ] **Step 5:** Run the test → PASS. Commit.

### Task 2: Route manual transactions through `withTransaction` (F5)

**Files:** `src/infrastructure/runtime.ts` (`receive`, three `claim`s, `replay`), `src/routes/internal.ts` (`/internal/conversations/control`), `src/services/dashboard/session-service.ts` (`login`, `revoke`), and every other site whose body is a plain BEGIN…COMMIT with no early `ROLLBACK; return`.

Sites that roll back early to return a value (`edge-inbound-message-processor.ts`) stay as they are and get the same rollback-safety through a local `rollbackQuietly(client)` helper exported from `src/db/transaction.ts`:

```ts
export async function rollbackQuietly(client: PoolClient): Promise<Error | undefined> {
  try { await client.query('ROLLBACK'); return undefined; }
  catch (error) { return error instanceof Error ? error : new Error(String(error)); }
}
```

- [ ] **Step 1:** Convert each site mechanically. Behaviour is unchanged, so existing integration tests are the safety net.
- [ ] **Step 2:** `npm run lint && npm test` → 305+ PASS. Commit.

### Task 3: Lease-fenced finalizers (F1)

**Files:**
- Modify: `src/infrastructure/runtime.ts`
- Modify: `src/worker/runtime-worker.ts`
- Test: `tests/runtime.integration.test.ts` (new `describe` block "lease fencing")

**Interfaces:**
- Produces: `export interface WorkerLease { workerId: string; attemptCount: number }`. `ClaimedInboxEvent`, `ClaimedOutboxCommand` and `ClaimedJob` gain `workerId: string`. Every finalizer (`complete`, `retry`, `deadLetter`, `ignore`, `markDelivered`, `markRetryable`, `markPermanentlyFailed`, `markDeliveryUnknown`, `JobRepository.complete/retry/deadLetter`) gains a trailing optional `lease?: WorkerLease` and returns `Promise<boolean>` (true when the row changed).

Fence clause, appended to each finalizer's `UPDATE … WHERE id=$1`:

```sql
AND ($N::text IS NULL OR (status='processing' AND locked_by=$N AND attempt_count=$M))
```

(`state`/`lock_owner` for the outbox table.)

- [ ] **Step 1: Write failing tests:** for each of inbox, outbox and jobs: claim with `worker-a`, expire the lease, reclaim with `worker-b`; finalize with worker-a's lease → returns `false`, row still `processing` and owned by `worker-b`, attempt #2 still open; finalize with worker-b's lease → returns `true`. Plus: replay during processing survives the stale worker's `complete`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the fence and the boolean return; the worker passes `{ workerId: this.workerName, attemptCount: claimed.attemptCount }` and logs `lease_lost` at warn when a finalizer returns false.
- [ ] **Step 4:** Run the whole integration file → PASS. Commit.

### Task 4: Worker loop resilience and graceful drain (F3, F4)

**Files:**
- Modify: `src/worker/runtime-worker.ts`, `src/worker-runner.ts`
- Modify: `src/infrastructure/runtime.ts` (add `WorkerHeartbeatRepository`)
- Test: `tests/runtime-worker-loop.test.ts`

**Interfaces:**
- Produces: `RuntimeWorker.stop(): Promise<void>` resolves after the in-flight tick finishes; `RuntimeWorker.run()` never rejects on a tick error; it logs, backs off (`errorBackoffMs`, doubling to `maxErrorBackoffMs`), and continues. Idle sleep is abortable so `stop()` returns promptly. New option `heartbeat?: { beat(input): Promise<void> }` (defaults to `WorkerHeartbeatRepository`).

- [ ] **Step 1: Failing tests** with fake repositories: (a) a `claim` that throws once, then succeeds: `run()` keeps going and processes the next batch; (b) `stop()` awaited during a slow handler resolves only after the handler's finalizer ran; (c) `stop()` during idle sleep resolves in < 100 ms with `idleSleepMs: 60_000`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; `worker-runner.ts` shutdown becomes `await worker.stop(); await closePool();` with a 30 s hard timeout.
- [ ] **Step 4:** Run → PASS. Commit.

### Task 5: Explicit outbox and job routing (F6)

**Files:**
- Create: `src/worker/runtime-routing.ts`
- Modify: `src/worker-runner.ts`
- Test: `tests/runtime-routing.test.ts`

**Interfaces:**
- Produces: `createOutboxRouter(deps: { messaging?: Dispatcher; calendar?: Dispatcher; notification: Dispatcher; waitlist: Dispatcher }): (command) => Promise<OutboxDispatchResult>` and `createJobRouter(deps: Record<string, (job) => Promise<JobProcessingResult>>)`.

Rules: `whatsapp.send_message` → messaging or `permanently_failed: messaging_dispatcher_disabled`; `calendar.create_event` → calendar or `calendar_dispatcher_disabled`; notification and waitlist families → their dispatchers; anything else → `permanently_failed: unsupported_outbox_command:<type>`. Unknown job types → `dead_lettered: unsupported_scheduled_job:<type>`.

- [ ] Steps: failing tests for each branch → implement → PASS → commit.

### Task 6: Whole-word opt-out detection (F2)

**Files:**
- Create: `src/domain/opt-out.ts`
- Modify: `src/services/edge-inbound-message-processor.ts`
- Test: `tests/opt-out.test.ts`

**Interfaces:**
- Produces: `isOptOutMessage(text: string): boolean`.

Rules: normalise (lower-case, strip Arabic diacritics and tatweel, fold `أإآ`→`ا`, punctuation and emoji to spaces); tokenise on whitespace; a keyword or phrase matches only as whole tokens; a keyword immediately followed by a number token is a reference ("block 3", "بلوك 5"), not a command.

- [ ] **Step 1: Failing tests.** True: `STOP`, `stop please`, `Stop!`, `unsubscribe`, `الغاء`, `إلغاء`, `مش مهتم`, `انا مش مهتم خلاص`, `بلوك`. False: `nonstop`, `stopover`, `unstoppable`, `في موقف للعربيات؟`, `عايز شقة في بلوك 3`, `مهتم جدا`, empty string.
- [ ] Steps: run → FAIL → implement → PASS → wire into processor → full suite → commit.

### Task 7: SSE stream robustness and session re-validation (F7)

**Files:**
- Modify: `src/services/dashboard/stream-service.ts`, `src/routes/dashboard/stream.ts`, `src/routes/dashboard/index.ts`
- Test: `tests/dashboard-stream.test.ts`

**Interfaces:**
- Produces: `DashboardEventBus.subscribe` removes the subscriber and rethrows when LISTEN fails. `dashboardStreamRoutes(app, { events, sessions })` subscribes before hijacking; every heartbeat re-resolves the bearer/cookie token and ends the stream with `event: session_expired` when it no longer resolves.

- [ ] Steps: failing tests (bus against a dead port leaves `subscriberCount === 0`; heartbeat guard closes on `null` session with fake timers) → implement → PASS → commit.

### Task 8: Consumer receipts on the DB clock; readiness without raw errors (F8, F9)

**Files:**
- Create: `src/repositories/consumer-receipt-repository.ts`
- Modify: `src/routes/internal.ts`, `src/routes/health.ts`
- Test: `tests/runtime.integration.test.ts` (consumer receipt lease), `tests/health-metrics.test.ts` (`/ready` with an unreachable DB returns `{ ok:false, database:'unavailable' }` and no `error` field)

Claim decides lease activity in SQL (`lease_until > now()`), inside `withTransaction`.

- [ ] Steps: failing tests → implement → PASS → commit.

### Task 9: De-duplicate helpers, delete dead code (F10)

**Files:**
- Create: `src/routes/public-ingress.ts` (`publicRateLimit()`, `publicRequestHeaders(request, extra?)`)
- Create: `src/integrations/messaging/payload-schema.ts` (`messagingPayloadSchema`)
- Modify: `src/routes/meta-webhooks.ts`, `src/routes/lead-ingress.ts`, `src/routes/waitlist.ts`, `src/routes/internal.ts`, `src/worker/messaging-outbox-dispatcher.ts`
- Delete: `src/services/meta-sender.ts`

Behaviour-preserving; the existing ingress, waitlist and dispatcher tests cover it. Note: the internal route's template `components` is `.optional().default([])` and the dispatcher's is `.default([])`; both accept the same inputs, so one schema with `.default([])` serves both.

- [ ] Steps: refactor → `npm run lint && npm test && npm run build` → commit.

---

## Self-Review

- Coverage: F1→T3, F2→T6, F3/F4→T4, F5→T1/T2, F6→T5, F7→T7, F8/F9→T8, F10→T1/T9.
- Types: `WorkerLease`, `Db`, `withTransaction`, `rollbackQuietly` are defined in the task that introduces them and only consumed later.
