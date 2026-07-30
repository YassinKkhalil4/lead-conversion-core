ALTER TABLE edge_active_turns
  DROP CONSTRAINT IF EXISTS edge_active_turns_status_check;

ALTER TABLE edge_active_turns
  ADD CONSTRAINT edge_active_turns_status_check
  CHECK (status IN ('processing','queued','sent','suppressed','fallback','failed'));
