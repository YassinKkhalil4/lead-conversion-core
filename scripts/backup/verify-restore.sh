#!/bin/sh
set -eu

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"
: "${EXPECTED_MIN_MIGRATIONS:=1}"

migration_count="$(psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM edge_schema_migrations")"
config_count="$(psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM edge_config_snapshots")"
heartbeat_table="$(psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('runtime.worker_heartbeats') IS NOT NULL")"
app_table_count="$(psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('app','runtime','configuration','audit','migration')")"

if [ "$migration_count" -lt "$EXPECTED_MIN_MIGRATIONS" ]; then
  echo "Restore verification failed: expected at least $EXPECTED_MIN_MIGRATIONS migrations, found $migration_count" >&2
  exit 1
fi

if [ "$heartbeat_table" != "t" ]; then
  echo "Restore verification failed: runtime.worker_heartbeats is missing" >&2
  exit 1
fi

echo "Restore verification queries passed"
echo "edge_schema_migrations=$migration_count"
echo "edge_config_snapshots=$config_count"
echo "new_schema_tables=$app_table_count"
