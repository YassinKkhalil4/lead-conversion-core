# Transition Status

Last updated: 2026-08-16

Current plan: big-bang replacement. Edge owns business logic, PostgreSQL owns durable state, and legacy n8n, Typebot, Airtable projection, legacy shadow, legacy active-turn, and legacy outbox compatibility paths are removed from the deployable app. This is not a gradual cutover plan.

Rollback model: restore the last approved PostgreSQL backup and repoint the Meta webhook/DNS routing back to the previous production stack. Do not rely on in-app fallback routes or compatibility workers.

| Area | Status | Notes |
|---|---|---|
| Big-bang schema cleanup | locally_verified | Migration `022_big_bang_cleanup.sql` keeps `edge_conversations`, `edge_active_turns`, `edge_message_events`, `edge_client_channels`, and `edge_lead_controls`; it drops `edge_outbox`, `edge_config_snapshots`, and the `migration` schema. |
| Runtime ingress/security | locally_verified | Public ingress has route-level rate limiting. `GET /metrics` requires `x-internal-secret`. Facebook lead ingress verifies `X-Hub-Signature-256` when enabled. |
| Google Calendar | locally_verified | Adapter uses OAuth refresh-token credentials, caches access tokens, refreshes after expiry, retries once on Calendar API 401, and treats token-endpoint failures as provider failures instead of silently using stale tokens. |
| Configuration | locally_verified | Runtime configuration reads only `configuration.versions` and `configuration.active_versions`. Seed publishing uses `config/seed-real-estate.json` through versioned configuration authority; legacy config fallback is removed. |
| Legacy compatibility removal | locally_verified | n8n compatibility routes/scripts, Typebot fallback handling, Airtable import/sync/reconciliation code, legacy shadow tooling, legacy active-turn route, and legacy outbox worker are removed from this branch. |
| Dashboard API | locally_verified | Session-authenticated `/api/*` surface behind `DASHBOARD_API_ENABLED`, off by default. Argon2id passwords, opaque server-side sessions, durable login throttling, role-based authorisation, and `client_id` scoping enforced in SQL. Actions reuse the existing outbox, SLA, and follow-up services; SSE is backed by PostgreSQL `LISTEN/NOTIFY`. See `docs/DASHBOARD_API.md`. |
| Dashboard UI | not_started | The Expo app (web, iOS, Android) is the next slice. The backend is a deliberate review checkpoint before any UI work. |
| Verification | locally_verified | `npm ci`, `npm run lint`, `npm test` (19 files, 187 tests, passed three consecutive runs), `npm run build`, `npm audit --audit-level=moderate`, `npm run test:smoke`, focused metrics/calendar/config tests, and a disposable PostgreSQL `npm run seed` check all passed locally. |
| External live verification | blocked | Rotated Meta credentials, Google Calendar credentials/calendar IDs, production DNS/webhook authority, and owner approval for production traffic switch are still external-owner actions. These do not block local implementation or tests. |

Production readiness is not claimed until the full local gates pass, live provider verification is completed with real credentials, and the owner approves the production webhook/routing change.
