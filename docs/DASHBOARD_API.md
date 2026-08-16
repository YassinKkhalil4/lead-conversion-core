# Dashboard API

Session-authenticated `/api/*` surface consumed by the lead-management dashboard
(web, iOS, Android). It sits beside the existing machine-to-machine routes and
shares their database, outbox, and audit conventions.

The conversation engine, scoring, and routing are untouched. This surface reads
their output and requests side effects through `runtime.outbox_commands`.

## Enabling it

The API is off by default and gated on `DASHBOARD_API_ENABLED`.

```bash
DASHBOARD_API_ENABLED=true
```

| Variable | Default | Purpose |
|---|---|---|
| `DASHBOARD_API_ENABLED` | `false` | Registers the `/api/*` plugin. |
| `DASHBOARD_SESSION_TTL_DAYS` | `30` | Session lifetime, also used by `/api/auth/refresh`. |
| `DASHBOARD_SESSION_COOKIE_NAME` | `lcc_session` | Cookie name for browser clients. |
| `DASHBOARD_SESSION_COOKIE_SECURE` | `true` | Set `false` only for local HTTP development. |
| `DASHBOARD_LOGIN_RATE_LIMIT_MAX` | `5` | Login attempts per window, per IP **and** per email. |
| `DASHBOARD_LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | Login throttle window (15 minutes). |

`META_APPROVED_TEMPLATE_NAMES` (existing) is the allow-list for replies sent
outside the 24-hour session window.

## Local development

```bash
npm ci
docker compose up -d lead-core-postgres
npm run migrate
DASHBOARD_API_ENABLED=true DASHBOARD_SESSION_COOKIE_SECURE=false npm run dev
```

Migrations `024_dashboard_users_sessions.sql` and
`025_dashboard_realtime_notify.sql` add the new tables and the `LISTEN/NOTIFY`
triggers. No existing table's columns or constraints were changed.

## Creating the first admin user

There is no signup route. Accounts are created by an admin, and the very first
one is created from the CLI:

```bash
npm run user:create -- --client-key acme_realty --email ops@acme.test --name "Ops Lead" --role admin
```

The command prints a generated password once; pass `--password` to choose your
own (minimum 12 characters). For a salesperson account, link it to an existing
salesperson record:

```bash
npm run user:create -- --client-key acme_realty --email sara@acme.test --name "Sara" --role salesperson --salesperson-phone +201001234567
```

In a built image use `npm run user:create:prod` with the same arguments.

## Authentication

Passwords are hashed with Argon2id (`@node-rs/argon2`, chosen over the `argon2`
package because it ships musl prebuilds and the runtime image is Alpine).

Session tokens are 32 random bytes, hex encoded. Only the SHA-256 digest is
stored; the digest presented on each request is compared with `timingSafeEqual`.
Login returns the token in the body (for `expo-secure-store` on mobile) and sets
an `HttpOnly; SameSite=Lax` cookie (for web).

| Route | Notes |
|---|---|
| `POST /api/auth/login` | `{ email, password, clientKey? }`. `clientKey` disambiguates one email across tenants. |
| `POST /api/auth/logout` | Revokes the current session. |
| `GET /api/auth/me` | Current user and session expiry. |
| `POST /api/auth/refresh` | Extends expiry; the token itself is unchanged. |
| `POST /api/auth/password` | Changes own password and revokes every session for that user. |

Login throttling is durable (`app.login_attempts`), so it is shared across API
instances and survives restarts. Five attempts per 15 minutes per IP and per
email; a successful login clears both counters. Exceeding it returns `429` with
a `retry-after` header.

## Authorisation

`request.dashboardSession` is resolved by a `preHandler` hook from either the
`Authorization: Bearer` header or the cookie.

**Every query is scoped by `client_id` inside the SQL `WHERE` clause**, never by
filtering application-side. The single implementation is `leadVisibilitySql` in
`src/services/dashboard/sql.ts`.

| Role | Leads | Other |
|---|---|---|
| `salesperson` | Assigned to their `salesperson_id`, plus leads with no active assignment | Own notifications, own device tokens |
| `manager` | All leads in the client | Salespeople and projects read/write, reports |
| `admin` | All leads in the client | Everything above, plus `/api/users` |

## Routes

Reads: `GET /api/leads` (filter by `status`, `temperature`, `assigned_to`
(`me` / `unassigned` / uuid), `source`, `created_from`, `created_to`, `q`,
`unacknowledged`; sort by `created_at`, `lead_score`, `last_message_at`),
`GET /api/leads/:id`, `GET /api/leads/:id/messages`, `GET /api/notifications`,
`GET /api/salespeople`, `GET /api/projects`, `GET /api/dashboard/summary`,
`GET /api/dashboard/activity`, `GET /api/users`.

Writes: `POST /api/leads/:id/{acknowledge,takeover,close,stop-followup,reply}`,
`POST /api/notifications/:id/read`, `POST /api/notifications/read-all`,
`POST|PATCH /api/salespeople`, `POST|PATCH /api/projects`, `POST /api/devices`,
`POST|PATCH /api/users`.

### Acknowledge

Sets `acknowledged_at` and cancels the pending SLA reminder and escalation in
`runtime.scheduled_jobs` **in the same transaction**, then writes an
`audit.events` row. A worker can therefore never send a reminder for an
assignment that was already acknowledged.

### Reply and the 24-hour window

`POST /api/leads/:id/reply` takes `{ requestKey, payload }` where `payload` is
either `{ kind: "text", text }` or
`{ kind: "template", templateName, languageCode }`.

`requestKey` is caller-generated and stable: the mobile client reuses it when
retrying a reply queued while offline, so a retry cannot double-send.

If the lead's last inbound message is older than 24 hours the route returns
`409 session_window_closed` with `allowedMessageKind: "template"`. Templates are
checked against `META_APPROVED_TEMPLATE_NAMES`.

Nothing is sent inline. `MessageRequestService` writes the `app.messages` row
and the `whatsapp.send_message` outbox command in one transaction; the messaging
worker performs the HTTP call afterwards.

### Takeover

Writes `edge_lead_controls.human_takeover`, which is the overlay the
conversation engine consults before replying, and mirrors it onto
`edge_conversations` and `app.conversations`. If the lead has no conversation
yet the control is pre-seeded so the first inbound message inherits it.

## Realtime

`GET /api/stream` is Server-Sent Events, authenticated and client-scoped.

A single dedicated connection `LISTEN`s on the `dashboard_events` channel;
triggers on `app.leads`, `app.messages`, `app.lead_assignments`, and
`app.notifications` publish **identifiers only** (payloads are capped at 8000
bytes and must not carry message bodies or PII). Before delivering to a
salesperson the service re-checks lead visibility in SQL rather than trusting
the payload.

Event names: `lead.created`, `lead.updated`, `message.created`,
`assignment.created`, `assignment.updated`, `notification.created`, plus a
`ready` event on connect. A `retry: 3000` hint and a 25-second keepalive comment
keep the connection alive through Caddy; `x-accel-buffering: no` prevents proxy
buffering.

## Known data caveats

These are properties of the existing system that the dashboard works around
rather than changing, since the conversation engine is out of scope:

- **`app.leads.last_message_at`, `first_reply_at` are never written** by the
  runtime. Recency and the session window are derived from `app.messages` and
  `app.conversations.conversation_window_expires_at` instead.
- **`audit.events.client_id` is never populated** by `AuditRepository`. The
  activity feed is scoped by resolving each event's `aggregate_id` back to a row
  the session may see, and is bounded to the last 30 days.

## Recommended follow-up indexes

Not applied, because this work was constrained to adding tables only. On a large
tenant these are the first things to add:

```sql
CREATE INDEX CONCURRENTLY messages_lead_created_idx ON app.messages (lead_id, created_at DESC);
CREATE INDEX CONCURRENTLY conversations_lead_idx ON app.conversations (lead_id, opened_at DESC);
CREATE INDEX CONCURRENTLY leads_client_created_idx ON app.leads (client_id, created_at DESC);
CREATE INDEX CONCURRENTLY lead_assignments_salesperson_status_idx ON app.lead_assignments (salesperson_id, status);
```

## Tests

`tests/dashboard-api.integration.test.ts` runs against a disposable PostgreSQL
cluster, seeding two tenants and covering login success and failure, rate
limiting, session expiry and revocation, role restrictions, acknowledge
cancelling SLA jobs, the reply session window, notification read state, the
realtime stream, and **explicit cross-client isolation for every list
endpoint**.

```bash
npx vitest run tests/dashboard-api.integration.test.ts
```
