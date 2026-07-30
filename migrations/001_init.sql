CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS edge_schema_migrations (
  migration_name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edge_config_snapshots (
  config_version text PRIMARY KEY,
  client_record_id text NULL,
  industry text NOT NULL,
  config_json jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS edge_config_one_active_per_scope
  ON edge_config_snapshots (COALESCE(client_record_id, ''), active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS edge_client_channels (
  phone_number_id text PRIMARY KEY,
  client_record_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  config_version text NULL REFERENCES edge_config_snapshots(config_version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edge_conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_record_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  phone_normalized text NOT NULL,
  lead_record_id text NOT NULL,
  lead_id text NOT NULL DEFAULT '',
  lead_name text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  project_name text NOT NULL DEFAULT '',
  project_record_id text NOT NULL DEFAULT '',
  preferred_language text NOT NULL DEFAULT '',
  current_stage text NOT NULL DEFAULT '',
  current_question_key text NOT NULL DEFAULT '',
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT '',
  human_takeover boolean NOT NULL DEFAULT false,
  stop_follow_up boolean NOT NULL DEFAULT false,
  closed_status text NOT NULL DEFAULT '',
  appointment_status text NOT NULL DEFAULT '',
  config_version text NOT NULL REFERENCES edge_config_snapshots(config_version),
  pending_outbound_id uuid NULL,
  state_version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_record_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS edge_conversations_lead_record_idx
  ON edge_conversations (lead_record_id);

CREATE TABLE IF NOT EXISTS edge_message_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES edge_conversations(conversation_id) ON DELETE CASCADE,
  client_record_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  external_event_id text NOT NULL,
  meta_message_id text NOT NULL DEFAULT '',
  provider_message_id text NOT NULL DEFAULT '',
  message_type text NOT NULL DEFAULT 'text',
  message_text text NOT NULL DEFAULT '',
  option_id text NOT NULL DEFAULT '',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'accepted',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_record_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS edge_shadow_evaluations (
  evaluation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES edge_conversations(conversation_id) ON DELETE CASCADE,
  inbound_event_id text NOT NULL,
  config_version text NOT NULL,
  stage_before text NOT NULL DEFAULT '',
  stage_after text NOT NULL DEFAULT '',
  decision_json jsonb NOT NULL,
  legacy_expected_json jsonb NULL,
  parity_status text NOT NULL DEFAULT 'not_compared',
  duration_ms numeric(12,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, inbound_event_id)
);

CREATE TABLE IF NOT EXISTS edge_outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES edge_conversations(conversation_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'parked')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  completed_at timestamptz NULL,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS edge_outbox_ready_idx
  ON edge_outbox (status, available_at, created_at);
