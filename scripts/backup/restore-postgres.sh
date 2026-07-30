#!/bin/sh
set -eu

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"
: "${ENCRYPTED_DUMP_PATH:?ENCRYPTED_DUMP_PATH is required}"
: "${BACKUP_ENCRYPTION_PASSWORD_FILE:?BACKUP_ENCRYPTION_PASSWORD_FILE is required}"

if [ ! -r "$BACKUP_ENCRYPTION_PASSWORD_FILE" ]; then
  echo "Backup encryption password file is not readable" >&2
  exit 1
fi

if [ ! -r "$ENCRYPTED_DUMP_PATH" ]; then
  echo "Encrypted dump path is not readable" >&2
  exit 1
fi

object_count="$(psql "$RESTORE_TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")"
if [ "$object_count" != "0" ] && [ "${RESTORE_ALLOW_NONEMPTY:-false}" != "true" ]; then
  echo "Restore target is not empty. Set RESTORE_ALLOW_NONEMPTY=true only for an intentional restore." >&2
  exit 1
fi

plain_dump="$(mktemp)"
cleanup() {
  rm -f "$plain_dump"
}
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass "file:$BACKUP_ENCRYPTION_PASSWORD_FILE" \
  -in "$ENCRYPTED_DUMP_PATH" \
  -out "$plain_dump"

pg_restore --exit-on-error --dbname="$RESTORE_TARGET_DATABASE_URL" "$plain_dump"
echo "Restore completed into target database"
