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

cleanup() {
  rm -f "$plain_dump" "$database_url_file" "$pg_service_file"
}
trap cleanup EXIT
chmod 600 "$plain_dump" "$database_url_file" "$pg_service_file"

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
echo "Encrypted backup written: $encrypted_dump"
echo "Checksum written: $checksum_file"
