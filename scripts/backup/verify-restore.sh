#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  echo "verify-restore.sh does not accept arguments; configure it with environment variables" >&2
  exit 2
fi

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"
: "${EXPECTED_MIN_MIGRATIONS:=1}"

restore_target_database_url_file="$(mktemp)"
pg_service_file="$(mktemp)"
cleanup() {
  rm -f "$restore_target_database_url_file" "$pg_service_file"
}
trap cleanup EXIT
chmod 600 "$restore_target_database_url_file" "$pg_service_file"

restore_target_database_url_value="$RESTORE_TARGET_DATABASE_URL"
unset RESTORE_TARGET_DATABASE_URL
printf '%s' "$restore_target_database_url_value" > "$restore_target_database_url_file"
unset restore_target_database_url_value
python3 scripts/backup/write-pg-service.py "$restore_target_database_url_file" "$pg_service_file" lead_core_restore_target
rm -f "$restore_target_database_url_file"

migration_count="$(PGSERVICEFILE="$pg_service_file" psql "service=lead_core_restore_target" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM edge_schema_migrations")"
config_count="$(PGSERVICEFILE="$pg_service_file" psql "service=lead_core_restore_target" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM edge_config_snapshots")"
heartbeat_table="$(PGSERVICEFILE="$pg_service_file" psql "service=lead_core_restore_target" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('runtime.worker_heartbeats') IS NOT NULL")"
app_table_count="$(PGSERVICEFILE="$pg_service_file" psql "service=lead_core_restore_target" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('app','runtime','configuration','audit','migration')")"

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
