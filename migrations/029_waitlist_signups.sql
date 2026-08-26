-- Waitlist signups from the marketing site.
--
-- Deliberately outside the client-scoped tables. Every candidate that already
-- exists (app.contacts, app.leads, app.lead_intake_events) carries
-- `client_id uuid NOT NULL REFERENCES app.clients`, and a waitlist signup is a
-- prospective client with no client row. Reusing one of them would mean
-- inventing a placeholder client, which would then surface in lead lists,
-- dashboard queries and reporting as if it were real pipeline.
CREATE TABLE IF NOT EXISTS app.waitlist_signups (
  waitlist_signup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  market text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  source text NOT NULL,
  request_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submission_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The idempotency key for the upsert. Normalisation is done in the service and
-- stored, rather than expressed as lower(email) here, so the unique index stays
-- a plain b-tree over a stored column and the ON CONFLICT target is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_normalized_idx
  ON app.waitlist_signups (email_normalized);

CREATE INDEX IF NOT EXISTS waitlist_signups_created_idx
  ON app.waitlist_signups (created_at DESC);

-- Fixed-window rate limit counters. Same shape and semantics as
-- app.login_attempts and app.lead_capture_attempts: one row per subject key,
-- a window that resets in place, so the cap survives restarts and is shared by
-- every process rather than living in per-process memory.
CREATE TABLE IF NOT EXISTS app.waitlist_attempts (
  waitlist_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_key text NOT NULL UNIQUE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_attempts_window_idx
  ON app.waitlist_attempts (window_started_at);
