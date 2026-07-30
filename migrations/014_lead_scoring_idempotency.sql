ALTER TABLE app.score_runs
  ADD COLUMN IF NOT EXISTS qualification_session_id uuid REFERENCES app.qualification_sessions(qualification_session_id),
  ADD COLUMN IF NOT EXISTS input_hash text NOT NULL DEFAULT 'legacy-import',
  ADD COLUMN IF NOT EXISTS source_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS score_runs_lead_version_input_uidx
  ON app.score_runs (lead_id, scoring_version, input_hash)
  WHERE input_hash <> 'legacy-import';

CREATE INDEX IF NOT EXISTS score_runs_lead_created_idx
  ON app.score_runs (lead_id, created_at DESC);
