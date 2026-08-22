-- Durable rate limiting for leads created from direct WhatsApp inbound.
--
-- Same shape and semantics as app.login_attempts: one row per subject key,
-- a fixed window that resets in place, so the cap survives restarts and is
-- shared by every worker rather than living in per-process memory.
CREATE TABLE IF NOT EXISTS app.lead_capture_attempts (
  lead_capture_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_key text NOT NULL UNIQUE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_capture_attempts_window_idx
  ON app.lead_capture_attempts (window_started_at);
