ALTER TABLE edge_outbox
  DROP CONSTRAINT IF EXISTS edge_outbox_status_check;

ALTER TABLE edge_outbox
  ADD CONSTRAINT edge_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'parked', 'dead_lettered'));
