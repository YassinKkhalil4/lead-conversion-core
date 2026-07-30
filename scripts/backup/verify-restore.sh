#!/bin/sh
set -eu

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"

psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM edge_schema_migrations" >/dev/null
psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM edge_config_snapshots" >/dev/null
psql "$RESTORE_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM runtime.worker_heartbeats" >/dev/null

echo "Restore verification queries passed"
