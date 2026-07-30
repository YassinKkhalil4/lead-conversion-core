CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS configuration;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS migration;

CREATE TABLE IF NOT EXISTS app.clients (
  client_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_airtable_id text UNIQUE,
  client_key text NOT NULL UNIQUE,
  company_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  manager_name text NOT NULL DEFAULT '',
  manager_phone_e164 text NOT NULL DEFAULT '',
  whatsapp_provider text NOT NULL DEFAULT 'meta',
  calendar_id text NOT NULL DEFAULT '',
  appointment_hours jsonb NOT NULL DEFAULT '["11:00","14:00","16:00"]'::jsonb,
  appointment_blackout_days text[] NOT NULL DEFAULT ARRAY['Friday'],
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.channels (
  channel_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  channel_type text NOT NULL,
  provider text NOT NULL,
  provider_channel_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_channel_id)
);

CREATE TABLE IF NOT EXISTS app.contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  legacy_airtable_id text,
  name text NOT NULL DEFAULT '',
  phone_raw text NOT NULL DEFAULT '',
  phone_e164 text NOT NULL,
  email text NOT NULL DEFAULT '',
  consent_status text NOT NULL DEFAULT 'unknown',
  opted_out boolean NOT NULL DEFAULT false,
  opt_out_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS app.projects (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES app.clients(client_id),
  legacy_airtable_id text UNIQUE,
  project_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  starting_price numeric,
  max_price numeric,
  unit_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  location text NOT NULL DEFAULT '',
  maps_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.salespeople (
  salesperson_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  legacy_airtable_id text UNIQUE,
  name text NOT NULL,
  phone_e164 text NOT NULL,
  email text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  unit_specialties text[] NOT NULL DEFAULT ARRAY[]::text[],
  locations text[] NOT NULL DEFAULT ARRAY[]::text[],
  languages text[] NOT NULL DEFAULT ARRAY[]::text[],
  priority_rank integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS app.salesperson_projects (
  salesperson_id uuid NOT NULL REFERENCES app.salespeople(salesperson_id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES app.projects(project_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (salesperson_id, project_id)
);

CREATE TABLE IF NOT EXISTS app.leads (
  lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  contact_id uuid NOT NULL REFERENCES app.contacts(contact_id),
  project_id uuid REFERENCES app.projects(project_id),
  legacy_airtable_id text UNIQUE,
  provider text NOT NULL DEFAULT '',
  provider_external_id text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  source_payload_hash text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  current_stage text NOT NULL DEFAULT '',
  first_received_at timestamptz,
  first_contacted_at timestamptz,
  first_reply_at timestamptz,
  last_message_at timestamptz,
  last_outbound_at timestamptz,
  temperature text NOT NULL DEFAULT '',
  lead_score integer,
  stop_follow_up boolean NOT NULL DEFAULT false,
  stop_reason text NOT NULL DEFAULT '',
  closed_status text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, provider, provider_external_id)
);

CREATE TABLE IF NOT EXISTS app.lead_intake_events (
  intake_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES app.leads(lead_id),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  contact_id uuid REFERENCES app.contacts(contact_id),
  provider text NOT NULL,
  provider_external_id text NOT NULL,
  idempotency_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_json jsonb NOT NULL,
  UNIQUE(client_id, provider, idempotency_key)
);

CREATE TABLE IF NOT EXISTS app.conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  contact_id uuid NOT NULL REFERENCES app.contacts(contact_id),
  lead_id uuid REFERENCES app.leads(lead_id),
  channel_id uuid REFERENCES app.channels(channel_id),
  configuration_version_id uuid,
  status text NOT NULL DEFAULT 'open',
  current_stage text NOT NULL DEFAULT '',
  current_question_key text NOT NULL DEFAULT '',
  preferred_language text NOT NULL DEFAULT '',
  human_takeover boolean NOT NULL DEFAULT false,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version integer NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_at timestamptz,
  conversation_window_expires_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES app.conversations(conversation_id),
  lead_id uuid REFERENCES app.leads(lead_id),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  contact_id uuid REFERENCES app.contacts(contact_id),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel text NOT NULL DEFAULT 'whatsapp',
  from_address text NOT NULL DEFAULT '',
  to_address text NOT NULL DEFAULT '',
  message_text text NOT NULL DEFAULT '',
  message_type text NOT NULL DEFAULT 'text',
  provider_message_id text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','queued','processing','accepted','sent','delivered','read','failed','delivery_unknown','cancelled')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_uidx
  ON app.messages (client_id, provider_message_id)
  WHERE provider_message_id <> '';

CREATE TABLE IF NOT EXISTS app.message_delivery_events (
  delivery_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES app.messages(message_id),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  provider_message_id text NOT NULL,
  provider_status text NOT NULL,
  provider_timestamp timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, provider_message_id, provider_status, provider_timestamp)
);

CREATE TABLE IF NOT EXISTS app.qualification_sessions (
  qualification_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES app.conversations(conversation_id),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  configuration_version_id uuid,
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.qualification_answers (
  qualification_answer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_session_id uuid NOT NULL REFERENCES app.qualification_sessions(qualification_session_id) ON DELETE CASCADE,
  question_key text NOT NULL,
  normalized_value text NOT NULL DEFAULT '',
  raw_value text NOT NULL DEFAULT '',
  parser_source text NOT NULL DEFAULT '',
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(qualification_session_id, question_key)
);

CREATE TABLE IF NOT EXISTS app.score_runs (
  score_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  scoring_version text NOT NULL,
  score integer NOT NULL,
  temperature text NOT NULL,
  factors_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.lead_assignments (
  lead_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  salesperson_id uuid NOT NULL REFERENCES app.salespeople(salesperson_id),
  routing_version text NOT NULL,
  status text NOT NULL DEFAULT 'assigned',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  closed_at timestamptz,
  UNIQUE(lead_id, status) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE IF NOT EXISTS app.followup_sequences (
  followup_sequence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES app.clients(client_id),
  sequence_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, sequence_key)
);

CREATE TABLE IF NOT EXISTS app.followup_steps (
  followup_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_sequence_id uuid NOT NULL REFERENCES app.followup_sequences(followup_sequence_id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  delay_seconds integer NOT NULL CHECK (delay_seconds >= 0),
  template_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(followup_sequence_id, step_order)
);

CREATE TABLE IF NOT EXISTS app.followups (
  followup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  followup_step_id uuid REFERENCES app.followup_steps(followup_step_id),
  status text NOT NULL DEFAULT 'scheduled',
  due_at timestamptz NOT NULL,
  sent_message_id uuid REFERENCES app.messages(message_id),
  cancelled_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.appointment_offers (
  appointment_offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  status text NOT NULL DEFAULT 'offered',
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.appointment_slots (
  appointment_slot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_offer_id uuid NOT NULL REFERENCES app.appointment_offers(appointment_offer_id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  status text NOT NULL DEFAULT 'offered',
  locked_at timestamptz,
  UNIQUE(appointment_offer_id, starts_at)
);

CREATE TABLE IF NOT EXISTS app.appointments (
  appointment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.leads(lead_id),
  appointment_slot_id uuid REFERENCES app.appointment_slots(appointment_slot_id),
  calendar_event_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS configuration.versions (
  configuration_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES app.clients(client_id),
  version_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft',
  config_json jsonb NOT NULL,
  checksum_sha256 text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE TABLE IF NOT EXISTS runtime.webhook_receipts (
  webhook_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  dedupe_key text NOT NULL,
  raw_body_sha256 text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  headers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  parse_status text NOT NULL DEFAULT 'received',
  UNIQUE(provider, dedupe_key)
);

CREATE TABLE IF NOT EXISTS runtime.inbox_events (
  inbox_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_receipt_id uuid REFERENCES runtime.webhook_receipts(webhook_receipt_id),
  provider text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  aggregate_key text NOT NULL DEFAULT '',
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  locked_at timestamptz,
  lock_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(provider, dedupe_key)
);

CREATE INDEX IF NOT EXISTS inbox_events_claim_idx
  ON runtime.inbox_events (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS runtime.outbox_commands (
  outbox_command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  aggregate_key text NOT NULL DEFAULT '',
  payload_json jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','retry','completed','delivery_unknown','dead_letter','cancelled')),
  locked_at timestamptz,
  lock_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_commands_claim_idx
  ON runtime.outbox_commands (state, available_at, created_at);

CREATE TABLE IF NOT EXISTS runtime.scheduled_jobs (
  scheduled_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  job_type text NOT NULL,
  aggregate_key text NOT NULL DEFAULT '',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz NOT NULL,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS runtime.dead_letters (
  dead_letter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  reason text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  replayed_at timestamptz
);

CREATE TABLE IF NOT EXISTS runtime.capability_rollouts (
  capability_rollout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  percentage integer NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime.rollout_overrides (
  rollout_override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key text NOT NULL,
  client_id uuid REFERENCES app.clients(client_id),
  phone_e164 text NOT NULL DEFAULT '',
  enabled boolean NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(capability_key, client_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS audit.events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES app.clients(client_id),
  actor_type text NOT NULL DEFAULT 'system',
  actor_id text NOT NULL DEFAULT '',
  event_type text NOT NULL,
  aggregate_type text NOT NULL DEFAULT '',
  aggregate_id uuid,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration.import_runs (
  import_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL DEFAULT 'airtable',
  source_path text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'dry_run',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS migration.airtable_raw_records (
  raw_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES migration.import_runs(import_run_id) ON DELETE CASCADE,
  table_name text NOT NULL,
  record_id text NOT NULL,
  content_hash text NOT NULL,
  fields_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(import_run_id, table_name, record_id)
);

CREATE TABLE IF NOT EXISTS migration.entity_map (
  entity_map_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL DEFAULT 'airtable',
  source_table text NOT NULL,
  source_record_id text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system, source_table, source_record_id, target_table)
);

CREATE TABLE IF NOT EXISTS migration.rejected_records (
  rejected_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES migration.import_runs(import_run_id) ON DELETE CASCADE,
  table_name text NOT NULL,
  record_id text NOT NULL,
  content_hash text NOT NULL,
  reason text NOT NULL,
  fields_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration.reconciliation_results (
  reconciliation_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid REFERENCES migration.import_runs(import_run_id) ON DELETE SET NULL,
  check_key text NOT NULL,
  status text NOT NULL,
  expected_count integer,
  actual_count integer,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
