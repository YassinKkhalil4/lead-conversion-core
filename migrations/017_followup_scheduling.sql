ALTER TABLE app.followups
  ADD COLUMN IF NOT EXISTS semantic_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scheduled_job_id uuid REFERENCES runtime.scheduled_jobs(scheduled_job_id),
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Cairo',
  ADD COLUMN IF NOT EXISTS sequence_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS step_order integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS followups_semantic_key_uidx
  ON app.followups (semantic_key)
  WHERE semantic_key <> '';

CREATE INDEX IF NOT EXISTS followups_lead_status_due_idx
  ON app.followups (lead_id, status, due_at);
