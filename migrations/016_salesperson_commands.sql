CREATE TABLE IF NOT EXISTS app.salesperson_commands (
  salesperson_command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_assignment_id uuid REFERENCES app.lead_assignments(lead_assignment_id),
  lead_id uuid REFERENCES app.leads(lead_id),
  client_id uuid REFERENCES app.clients(client_id),
  salesperson_id uuid REFERENCES app.salespeople(salesperson_id),
  provider text NOT NULL,
  external_event_id text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  from_phone_e164 text NOT NULL DEFAULT '',
  command_text text NOT NULL DEFAULT '',
  command_intent text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('processed','rejected','ignored')),
  outcome_reason text NOT NULL DEFAULT '',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS salesperson_commands_lead_created_idx
  ON app.salesperson_commands (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_commands_salesperson_created_idx
  ON app.salesperson_commands (salesperson_id, created_at DESC);
