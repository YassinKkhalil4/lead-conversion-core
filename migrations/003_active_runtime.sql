ALTER TABLE edge_client_channels
  ADD COLUMN IF NOT EXISTS direct_send_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graph_phone_number_id text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS edge_active_turns (
  active_turn_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES edge_conversations(conversation_id) ON DELETE CASCADE,
  client_record_id text NOT NULL,
  meta_message_id text NOT NULL,
  inbound_event_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','sent','suppressed','fallback','failed')),
  decision_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_message_id text NOT NULL DEFAULT '',
  send_response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_record_id, meta_message_id)
);

CREATE INDEX IF NOT EXISTS edge_active_turns_conversation_idx
  ON edge_active_turns (conversation_id, created_at DESC);
