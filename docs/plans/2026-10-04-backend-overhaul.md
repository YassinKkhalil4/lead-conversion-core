# Backend overhaul — 2026-10-04

Scope: backend and logic only (`src/`, `tests/`, CI). No frontend, landing or
UI changes. Baseline at `50afea0`: lint clean, `npm audit` 0 vulnerabilities,
363/364 tests pass with real PostgreSQL, 183 pass and 181 silently skip without it.

## Architecture as found

Fastify modular monolith. PostgreSQL is authoritative; public events enter a
durable inbox, side effects leave through a durable outbox, scheduled work is
rows in `runtime.scheduled_jobs`. The worker claims with `FOR UPDATE SKIP LOCKED`,
leases carry (owner, attempt) fencing, retries are bounded and dead-lettered,
ambiguous delivery is a first-class outcome. The previous overhaul fixed the big
classes of defect: no `any`, no string-built SQL, transactions go through one
rollback-safe helper, secrets compare in constant time on the auth paths.

## Findings

| # | Sev | Finding | Where |
|---|-----|---------|-------|
| 1 | High | Integration tests (181 of 364) skip silently when `initdb` is not on PATH. A CI run without Postgres is green while testing none of the SQL, the queue, or the dashboard API. The detection is copy-pasted into 9 files. | `tests/*.integration.test.ts` |
| 2 | Med | One test depends on the calendar date: it inserts a lead 40 days ago and expects it in the *previous calendar month*. It fails for the first ~9 days of any month. | `tests/dashboard-api.integration.test.ts:~757` |
| 3 | Med | No CI at all, and `npm run lint` is only `tsc`. Nothing enforces the gates `AGENTS.md` lists. | repo root |
| 4 | Low | Meta webhook verify token compared with `!==` (not constant time). Three private copies of `safeEqual` exist. | `src/routes/meta-webhooks.ts`, `src/routes/auth.ts` |
| 5 | Low | Global error handler trusts `error.statusCode` blindly: a non-HTTP value (0, NaN, 999) makes `reply.code()` throw inside the handler. It is also untested and inlined in `buildApp`. | `src/app.ts` |
| 6 | Low | `/ready` swallows a failing heartbeat query with `.catch(() => ({ rows: [] }))`, so a broken `runtime.worker_heartbeats` is invisible in logs. | `src/routes/health.ts` |
| 7 | Info | Worker processes a claimed batch sequentially on a fixed lease with no renewal; a slow batch can outlive its lease under multiple workers. Single worker today, so benign. | `src/worker/runtime-worker.ts` |
| 8 | Info | `due_at` for SLA and follow-ups comes from the app clock, leases from the DB clock. Same host today. | `sla-service.ts`, `followup-scheduler-service.ts` |
| 9 | Info | `edge-inbound-message-processor.ts` (940 lines) and `runtime.ts` (845) are large. Refactoring them blind is riskier than leaving them; they have broad integration coverage. | |
| 10 | Info | README and BUILD_REPORT still describe the retired n8n shadow-mode design. | docs |

Findings 7–10 are recorded, not changed: they are design decisions or have no
present failure, and changing queue semantics without a reproduction is the
kind of "improvement" that causes duplicate sends.

## Plan (executed in this order, tests green after each step)

1. **Test integrity.** Shared `tests/helpers/postgres.ts`; `REQUIRE_PG_TESTS=1`
   turns a missing Postgres into a failing test instead of a skip. Replace the 9
   copies. Make the previous-period test calendar-independent.
2. **One `safeEqual`.** Export from `src/routes/auth.ts`, use for the Meta verify
   token, add unit tests for the verification handshake (all branches).
3. **Error handler.** Extract to `src/routes/error-handler.ts`; only accept integer
   statuses 400–599; log under `err`; unit tests.
4. **`/ready`.** Log the heartbeat-query failure instead of swallowing it. Response
   shape unchanged (`verify-deployment.sh` and the docs rely on it).
5. **CI.** `.github/workflows/ci.yml`: install, lint, build, tests with a Postgres
   service and `REQUIRE_PG_TESTS=1`, `npm audit --audit-level=moderate`.
6. **Verify.** Full suite with real Postgres and strict mode, lint, build.

Nothing is pushed or deployed from this branch.
