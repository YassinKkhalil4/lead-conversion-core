ALTER TABLE edge_client_channels
  DROP CONSTRAINT IF EXISTS edge_client_channels_config_version_fkey;

ALTER TABLE edge_conversations
  DROP CONSTRAINT IF EXISTS edge_conversations_config_version_fkey;

DROP TABLE IF EXISTS edge_shadow_evaluations CASCADE;
DROP TABLE IF EXISTS edge_outbox CASCADE;
DROP TABLE IF EXISTS edge_config_snapshots CASCADE;
DROP SCHEMA IF EXISTS migration CASCADE;
