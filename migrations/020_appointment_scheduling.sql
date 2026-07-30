ALTER TABLE app.appointment_offers
  ADD COLUMN IF NOT EXISTS semantic_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Cairo',
  ADD COLUMN IF NOT EXISTS cancelled_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS appointment_offers_semantic_key_uidx
  ON app.appointment_offers (semantic_key)
  WHERE semantic_key <> '';

ALTER TABLE app.appointment_slots
  ADD COLUMN IF NOT EXISTS semantic_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS appointment_slots_semantic_key_uidx
  ON app.appointment_slots (semantic_key)
  WHERE semantic_key <> '';

CREATE INDEX IF NOT EXISTS appointment_slots_offer_status_starts_idx
  ON app.appointment_slots (appointment_offer_id, status, starts_at);

ALTER TABLE app.appointments
  ADD COLUMN IF NOT EXISTS appointment_offer_id uuid REFERENCES app.appointment_offers(appointment_offer_id),
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS outbox_command_id uuid REFERENCES runtime.outbox_commands(outbox_command_id),
  ADD COLUMN IF NOT EXISTS booked_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_event_id text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS appointments_idempotency_key_uidx
  ON app.appointments (idempotency_key)
  WHERE idempotency_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_active_uidx
  ON app.appointments (appointment_slot_id)
  WHERE status IN ('pending','booked','confirmed');
