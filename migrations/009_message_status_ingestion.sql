ALTER TABLE app.message_delivery_events
  ADD COLUMN IF NOT EXISTS event_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS message_delivery_events_event_key_uidx
  ON app.message_delivery_events (client_id, event_key)
  WHERE event_key <> '';
