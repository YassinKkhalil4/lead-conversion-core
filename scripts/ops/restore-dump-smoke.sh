#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  echo "restore-dump-smoke.sh does not accept arguments" >&2
  exit 2
fi

: "${DUMP_PATH:?DUMP_PATH is required}"
POSTGRES_DOCKER_IMAGE="${POSTGRES_DOCKER_IMAGE:-postgres:16-alpine}"
COUNT_TABLES="${COUNT_TABLES:-edge_schema_migrations,edge_conversations,edge_outbox,workflow_entity,credentials_entity,execution_entity}"

if [ ! -r "$DUMP_PATH" ]; then
  echo "Dump path is not readable" >&2
  exit 1
fi

dump_dir="$(cd "$(dirname "$DUMP_PATH")" && pwd)"
dump_file="$(basename "$DUMP_PATH")"

docker run --rm \
  -v "$dump_dir:/dumps:ro" \
  -e DUMP_FILE="$dump_file" \
  -e COUNT_TABLES="$COUNT_TABLES" \
  "$POSTGRES_DOCKER_IMAGE" \
  sh -eu <<'CONTAINER'
tmp="/tmp/lead-core-restore-smoke"
data="$tmp/data"
socket_dir="$tmp/socket"
db="restore_smoke"
port="55432"
mkdir -p "$data" "$socket_dir"

pg_ctl_stop() {
  pg_ctl -D "$data" -m fast stop >/dev/null 2>&1 || true
}
trap pg_ctl_stop EXIT

initdb -D "$data" -A trust --no-locale >/dev/null
pg_ctl -D "$data" -o "-p $port -k $socket_dir" -l "$tmp/postgres.log" start >/dev/null
createdb -h "$socket_dir" -p "$port" "$db"

case "$DUMP_FILE" in
  *.sql)
    psql -h "$socket_dir" -p "$port" -d "$db" -v ON_ERROR_STOP=1 -f "/dumps/$DUMP_FILE" >/dev/null
    ;;
  *)
    pg_restore --no-owner --no-privileges -h "$socket_dir" -p "$port" -d "$db" "/dumps/$DUMP_FILE" >/dev/null
    ;;
esac

psql_base="psql -h $socket_dir -p $port -d $db -At -v ON_ERROR_STOP=1"
echo "restore_ok=true"
$psql_base -c "SELECT 'schemas=' || count(*) FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema'"
$psql_base -c "SELECT 'tables=' || count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE'"

old_ifs="$IFS"
IFS=","
for table_name in $COUNT_TABLES; do
  IFS="$old_ifs"
  case "$table_name" in
    ""|*[!A-Za-z0-9_.]*|[0-9]*|*.*.*)
      echo "Skipping invalid COUNT_TABLES entry: $table_name" >&2
      ;;
    *)
      exists="$($psql_base -c "SELECT to_regclass('$table_name') IS NOT NULL")"
      if [ "$exists" = "t" ]; then
        count="$($psql_base -c "SELECT count(*) FROM $table_name")"
        echo "$table_name=$count"
      fi
      ;;
  esac
  IFS=","
done
IFS="$old_ifs"
CONTAINER
