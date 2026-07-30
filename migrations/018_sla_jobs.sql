CREATE TABLE IF NOT EXISTS app.sla_jobs (
  sla_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  lead_assignment_id uuid REFERENCES app.lead_assignments(lead_assignment_id),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  salesperson_id uuid REFERENCES app.salespeople(salesperson_id),
  semantic_key text NOT NULL,
  sla_type text NOT NULL CHECK (sla_type IN ('assignment_ack_reminder','assignment_ack_escalation','stale_qualified_escalation')),
  status text NOT NULL CHECK (status IN ('scheduled','sent','cancelled')) DEFAULT 'scheduled',
  due_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  scheduled_job_id uuid REFERENCES runtime.scheduled_jobs(scheduled_job_id),
  outbox_command_id uuid REFERENCES runtime.outbox_commands(outbox_command_id),
  cancelled_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(semantic_key)
);

CREATE INDEX IF NOT EXISTS sla_jobs_lead_status_due_idx
  ON app.sla_jobs (lead_id, status, due_at);

CREATE INDEX IF NOT EXISTS sla_jobs_assignment_status_idx
  ON app.sla_jobs (lead_assignment_id, status);
