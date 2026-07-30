ALTER TABLE edge_outbox
  ADD COLUMN IF NOT EXISTS event_sequence bigserial;

CREATE UNIQUE INDEX IF NOT EXISTS edge_outbox_event_sequence_uidx
  ON edge_outbox (event_sequence);

CREATE INDEX IF NOT EXISTS edge_outbox_conversation_sequence_idx
  ON edge_outbox (conversation_id, event_sequence);
