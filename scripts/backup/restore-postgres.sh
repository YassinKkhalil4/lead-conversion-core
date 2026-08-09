#!/bin/sh
set -eu

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"
: "${ENCRYPTED_DUMP_PATH:?ENCRYPTED_DUMP_PATH is required}"
: "${BACKUP_ENCRYPTION_PASSWORD_FILE:?BACKUP_ENCRYPTION_PASSWORD_FILE is required}"
: "${RESTORE_SKIP_CHECKSUM:=false}"

if [ ! -r "$BACKUP_ENCRYPTION_PASSWORD_FILE" ]; then
  echo "Backup encryption password file is not readable" >&2
  exit 1
fi

if [ ! -r "$ENCRYPTED_DUMP_PATH" ]; then
  echo "Encrypted dump path is not readable" >&2
  exit 1
fi

if [ "$RESTORE_SKIP_CHECKSUM" != "true" ]; then
  checksum_path="${ENCRYPTED_DUMP_SHA256_PATH:-$ENCRYPTED_DUMP_PATH.sha256}"
  if [ ! -r "$checksum_path" ]; then
    echo "Backup checksum file is not readable. Set RESTORE_SKIP_CHECKSUM=true only for an intentional unchecked restore." >&2
    exit 1
  fi
  expected_checksum="$(awk 'NR == 1 { print $1 }' "$checksum_path")"
  if ! printf '%s\n' "$expected_checksum" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    echo "Backup checksum file is malformed: $checksum_path" >&2
    exit 1
  fi
  actual_checksum="$(scripts/backup/sha256-file.sh "$ENCRYPTED_DUMP_PATH")"
  if [ "$actual_checksum" != "$expected_checksum" ]; then
    echo "Backup checksum mismatch; refusing to restore encrypted dump" >&2
    exit 1
  fi
  unset actual_checksum expected_checksum checksum_path
fi

restore_target_database_url_file="$(mktemp)"
pg_service_file="$(mktemp)"
plain_dump="$(mktemp)"
cleanup() {
  rm -f "$plain_dump" "$restore_target_database_url_file" "$pg_service_file"
}
trap cleanup EXIT
chmod 600 "$plain_dump" "$restore_target_database_url_file" "$pg_service_file"

restore_target_database_url_value="$RESTORE_TARGET_DATABASE_URL"
unset RESTORE_TARGET_DATABASE_URL
printf '%s' "$restore_target_database_url_value" > "$restore_target_database_url_file"
unset restore_target_database_url_value
python3 scripts/backup/write-pg-service.py "$restore_target_database_url_file" "$pg_service_file" lead_core_restore_target
rm -f "$restore_target_database_url_file"

object_count="$(PGSERVICEFILE="$pg_service_file" psql "service=lead_core_restore_target" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")"
if [ "$object_count" != "0" ] && [ "${RESTORE_ALLOW_NONEMPTY:-false}" != "true" ]; then
  echo "Restore target is not empty. Set RESTORE_ALLOW_NONEMPTY=true only for an intentional restore." >&2
  exit 1
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass "file:$BACKUP_ENCRYPTION_PASSWORD_FILE" \
  -in "$ENCRYPTED_DUMP_PATH" \
  -out "$plain_dump"

PGSERVICEFILE="$pg_service_file" pg_restore --exit-on-error --dbname="service=lead_core_restore_target" "$plain_dump"
echo "Restore completed into target database"
