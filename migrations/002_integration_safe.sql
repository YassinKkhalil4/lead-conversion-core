ALTER TABLE edge_conversations
  ADD COLUMN IF NOT EXISTS conversation_engine text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS state_authority text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS conversation_window_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS assigned_salesperson_record_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assigned_salesperson_phone text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE edge_conversations
    ADD CONSTRAINT edge_conversation_engine_check
    CHECK (conversation_engine IN ('legacy','edge'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE edge_conversations
    ADD CONSTRAINT edge_state_authority_check
    CHECK (state_authority IN ('legacy','edge'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS edge_message_meta_id_unique
  ON edge_message_events (client_record_id, meta_message_id)
  WHERE meta_message_id <> '';

ALTER TABLE edge_shadow_evaluations
  ADD COLUMN IF NOT EXISTS meta_message_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS parity_differences_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS edge_shadow_meta_id_unique
  ON edge_shadow_evaluations (conversation_id, meta_message_id)
  WHERE meta_message_id <> '';

CREATE TABLE IF NOT EXISTS edge_lead_controls (
  client_record_id text NOT NULL,
  phone_normalized text NOT NULL,
  lead_record_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  current_stage text NOT NULL DEFAULT '',
  human_takeover boolean NOT NULL DEFAULT false,
  stop_follow_up boolean NOT NULL DEFAULT false,
  closed_status text NOT NULL DEFAULT '',
  appointment_status text NOT NULL DEFAULT '',
  assigned_salesperson_record_id text NOT NULL DEFAULT '',
  assigned_salesperson_phone text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'n8n',
  source_event_id text NOT NULL DEFAULT '',
  control_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_record_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS edge_lead_controls_lead_idx
  ON edge_lead_controls (lead_record_id);

CREATE TABLE IF NOT EXISTS edge_consumer_receipts (
  consumer_name text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','completed','failed')),
  lease_until timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, idempotency_key)
);

CREATE TABLE IF NOT EXISTS edge_ownership_audit (
  ownership_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES edge_conversations(conversation_id) ON DELETE CASCADE,
  previous_engine text NOT NULL,
  new_engine text NOT NULL,
  previous_authority text NOT NULL,
  new_authority text NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
