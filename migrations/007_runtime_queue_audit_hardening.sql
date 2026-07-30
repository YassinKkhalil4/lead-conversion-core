ALTER TABLE runtime.webhook_receipts
  ADD COLUMN IF NOT EXISTS raw_body bytea,
  ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '';

ALTER TABLE runtime.webhook_receipts
  ALTER COLUMN raw_body SET DEFAULT '\x'::bytea;

UPDATE runtime.webhook_receipts
SET raw_body = '\x'::bytea
WHERE raw_body IS NULL;

ALTER TABLE runtime.webhook_receipts
  ALTER COLUMN raw_body SET NOT NULL;

ALTER TABLE runtime.inbox_events
  ADD COLUMN IF NOT EXISTS external_event_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locked_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ignored_reason text NOT NULL DEFAULT '';

ALTER TABLE runtime.inbox_events
  DROP CONSTRAINT IF EXISTS inbox_events_status_check;

ALTER TABLE runtime.inbox_events
  ADD CONSTRAINT inbox_events_status_check
  CHECK (status IN ('pending','processing','processed','retryable','dead_lettered','ignored'));

CREATE INDEX IF NOT EXISTS inbox_events_recover_idx
  ON runtime.inbox_events (status, lock_expires_at)
  WHERE status='processing';

CREATE TABLE IF NOT EXISTS runtime.inbox_event_attempts (
  inbox_event_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_event_id uuid NOT NULL REFERENCES runtime.inbox_events(inbox_event_id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  worker_id text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT 'claimed',
  error_class text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(inbox_event_id, attempt_no)
);

ALTER TABLE runtime.outbox_commands
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lock_owner text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS next_attempt_after timestamptz,
  ADD COLUMN IF NOT EXISTS retry_hint_after timestamptz;

ALTER TABLE runtime.outbox_commands
  DROP CONSTRAINT IF EXISTS outbox_commands_state_check;

UPDATE runtime.outbox_commands
SET state = CASE state
  WHEN 'retry' THEN 'retryable'
  WHEN 'completed' THEN 'delivered'
  WHEN 'dead_letter' THEN 'dead_lettered'
  ELSE state
END;

ALTER TABLE runtime.outbox_commands
  ADD CONSTRAINT outbox_commands_state_check
  CHECK (state IN ('pending','processing','delivered','retryable','permanently_failed','cancelled','dead_lettered','delivery_unknown'));

CREATE INDEX IF NOT EXISTS outbox_commands_recover_idx
  ON runtime.outbox_commands (state, lock_expires_at)
  WHERE state='processing';

CREATE TABLE IF NOT EXISTS runtime.outbox_command_attempts (
  outbox_command_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_command_id uuid NOT NULL REFERENCES runtime.outbox_commands(outbox_command_id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  worker_id text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT 'claimed',
  provider_status integer,
  provider_message_id text NOT NULL DEFAULT '',
  retryable boolean,
  ambiguous boolean NOT NULL DEFAULT false,
  error_class text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(outbox_command_id, attempt_no)
);

ALTER TABLE runtime.scheduled_jobs
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS recurrence_json jsonb,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES runtime.scheduled_jobs(scheduled_job_id),
  ADD COLUMN IF NOT EXISTS locked_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cancelled_reason text NOT NULL DEFAULT '';

ALTER TABLE runtime.scheduled_jobs
  DROP CONSTRAINT IF EXISTS scheduled_jobs_status_check;

ALTER TABLE runtime.scheduled_jobs
  ADD CONSTRAINT scheduled_jobs_status_check
  CHECK (status IN ('pending','processing','completed','retryable','cancelled','dead_lettered','superseded'));

CREATE INDEX IF NOT EXISTS scheduled_jobs_claim_idx
  ON runtime.scheduled_jobs (status, due_at, created_at);

CREATE INDEX IF NOT EXISTS scheduled_jobs_recover_idx
  ON runtime.scheduled_jobs (status, lock_expires_at)
  WHERE status='processing';

CREATE TABLE IF NOT EXISTS runtime.scheduled_job_attempts (
  scheduled_job_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_job_id uuid NOT NULL REFERENCES runtime.scheduled_jobs(scheduled_job_id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  worker_id text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT 'claimed',
  error_class text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(scheduled_job_id, attempt_no)
);

ALTER TABLE audit.events
  ADD COLUMN IF NOT EXISTS correlation_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS causation_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS before_json jsonb,
  ADD COLUMN IF NOT EXISTS after_json jsonb;

CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON audit.events (correlation_id, created_at);

CREATE INDEX IF NOT EXISTS audit_events_aggregate_idx
  ON audit.events (aggregate_type, aggregate_id, created_at);

CREATE OR REPLACE FUNCTION audit.prevent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only_update ON audit.events;
CREATE TRIGGER audit_events_append_only_update
BEFORE UPDATE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.prevent_event_mutation();

DROP TRIGGER IF EXISTS audit_events_append_only_delete ON audit.events;
CREATE TRIGGER audit_events_append_only_delete
BEFORE DELETE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.prevent_event_mutation();
