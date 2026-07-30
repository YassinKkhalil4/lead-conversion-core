CREATE TABLE IF NOT EXISTS app.routing_runs (
  routing_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  score_run_id uuid REFERENCES app.score_runs(score_run_id),
  routing_version text NOT NULL,
  input_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('assigned','no_eligible_salesperson','suppressed')),
  selected_salesperson_id uuid REFERENCES app.salespeople(salesperson_id),
  candidates_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, routing_version, input_hash)
);

CREATE INDEX IF NOT EXISTS routing_runs_lead_created_idx
  ON app.routing_runs (lead_id, created_at DESC);

ALTER TABLE app.lead_assignments
  ADD COLUMN IF NOT EXISTS routing_run_id uuid REFERENCES app.routing_runs(routing_run_id),
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS lead_assignments_idempotency_uidx
  ON app.lead_assignments (idempotency_key)
  WHERE idempotency_key <> '';
