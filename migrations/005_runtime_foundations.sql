CREATE SCHEMA IF NOT EXISTS runtime;

CREATE TABLE IF NOT EXISTS runtime.worker_heartbeats (
  worker_name text PRIMARY KEY,
  worker_kind text NOT NULL,
  process_id integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_kind_heartbeat_idx
  ON runtime.worker_heartbeats (worker_kind, heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS runtime.backup_verifications (
  verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_dump text NOT NULL,
  target_database text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
