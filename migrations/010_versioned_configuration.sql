ALTER TABLE configuration.versions
  ADD COLUMN IF NOT EXISTS client_record_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'compiled_config.v1',
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_ref text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS diff_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS published_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supersedes_version_id uuid REFERENCES configuration.versions(configuration_version_id);

ALTER TABLE configuration.versions
  DROP CONSTRAINT IF EXISTS configuration_versions_status_check;

ALTER TABLE configuration.versions
  ADD CONSTRAINT configuration_versions_status_check
  CHECK (status IN ('draft','published','archived'));

CREATE TABLE IF NOT EXISTS configuration.active_versions (
  scope_key text PRIMARY KEY,
  client_id uuid REFERENCES app.clients(client_id),
  client_record_id text NOT NULL DEFAULT '',
  configuration_version_id uuid NOT NULL REFERENCES configuration.versions(configuration_version_id),
  activated_by text NOT NULL DEFAULT '',
  activated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS configuration_versions_client_status_idx
  ON configuration.versions (client_id, client_record_id, status, created_at);

CREATE OR REPLACE FUNCTION configuration.prevent_published_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published_configuration_versions_are_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS configuration_versions_published_update_guard ON configuration.versions;
CREATE TRIGGER configuration_versions_published_update_guard
BEFORE UPDATE ON configuration.versions
FOR EACH ROW EXECUTE FUNCTION configuration.prevent_published_version_mutation();

DROP TRIGGER IF EXISTS configuration_versions_published_delete_guard ON configuration.versions;
CREATE TRIGGER configuration_versions_published_delete_guard
BEFORE DELETE ON configuration.versions
FOR EACH ROW EXECUTE FUNCTION configuration.prevent_published_version_mutation();
