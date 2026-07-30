ALTER TABLE edge_conversations
  ADD COLUMN IF NOT EXISTS configuration_version_id uuid REFERENCES configuration.versions(configuration_version_id);

CREATE INDEX IF NOT EXISTS edge_conversations_configuration_version_idx
  ON edge_conversations (configuration_version_id)
  WHERE configuration_version_id IS NOT NULL;
