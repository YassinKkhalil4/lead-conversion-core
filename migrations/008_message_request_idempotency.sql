ALTER TABLE app.messages
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_uidx
  ON app.messages (client_id, idempotency_key)
  WHERE idempotency_key <> '';
