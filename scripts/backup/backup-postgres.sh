#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:=./backups}"
: "${BACKUP_ENCRYPTION_PASSWORD_FILE:?BACKUP_ENCRYPTION_PASSWORD_FILE is required}"

if [ ! -r "$BACKUP_ENCRYPTION_PASSWORD_FILE" ]; then
  echo "Backup encryption password file is not readable" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain_dump="$(mktemp)"
database_url_file="$(mktemp)"
pg_service_file="$(mktemp)"
encrypted_dump="$BACKUP_DIR/lead-core-postgres-$timestamp.dump.enc"
checksum_file="$encrypted_dump.sha256"
output_lock="$encrypted_dump.lock"
output_paths_reserved="false"
backup_complete="false"

cleanup() {
  rm -f "$plain_dump" "$database_url_file" "$pg_service_file"
  if [ "$backup_complete" != "true" ] && [ "$output_paths_reserved" = "true" ]; then
    rm -f "$encrypted_dump" "$checksum_file"
  fi
  rmdir "$output_lock" 2>/dev/null || true
}
trap cleanup EXIT
chmod 600 "$plain_dump" "$database_url_file" "$pg_service_file"

if ! mkdir "$output_lock"; then
  echo "Backup output lock already exists: $output_lock" >&2
  exit 1
fi

if [ -e "$encrypted_dump" ] || [ -e "$checksum_file" ]; then
  echo "Backup output already exists for timestamp $timestamp; refusing to overwrite" >&2
  exit 1
fi
output_paths_reserved="true"

database_url_value="$DATABASE_URL"
unset DATABASE_URL
printf '%s' "$database_url_value" > "$database_url_file"
unset database_url_value
python3 scripts/backup/write-pg-service.py "$database_url_file" "$pg_service_file" lead_core_backup_source
rm -f "$database_url_file"

PGSERVICEFILE="$pg_service_file" pg_dump --format=custom --no-owner --no-privileges --dbname="service=lead_core_backup_source" --file="$plain_dump"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -pass "file:$BACKUP_ENCRYPTION_PASSWORD_FILE" \
  -in "$plain_dump" \
  -out "$encrypted_dump"

sha256sum "$encrypted_dump" > "$checksum_file"
backup_complete="true"
echo "Encrypted backup written: $encrypted_dump"
echo "Checksum written: $checksum_file"
