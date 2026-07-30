CREATE TABLE IF NOT EXISTS app.daily_reports (
  daily_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  semantic_key text NOT NULL,
  report_date date NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  status text NOT NULL CHECK (status IN ('scheduled','sent','cancelled')) DEFAULT 'scheduled',
  scheduled_job_id uuid REFERENCES runtime.scheduled_jobs(scheduled_job_id),
  outbox_command_id uuid REFERENCES runtime.outbox_commands(outbox_command_id),
  recipient_phone_e164 text NOT NULL DEFAULT '',
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancelled_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(semantic_key),
  UNIQUE(client_id, report_date)
);

CREATE INDEX IF NOT EXISTS daily_reports_client_status_date_idx
  ON app.daily_reports (client_id, status, report_date);

CREATE INDEX IF NOT EXISTS daily_reports_scheduled_job_idx
  ON app.daily_reports (scheduled_job_id)
  WHERE scheduled_job_id IS NOT NULL;
