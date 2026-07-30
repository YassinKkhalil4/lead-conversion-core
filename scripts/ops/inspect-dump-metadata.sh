#!/bin/sh
set -eu

: "${DUMP_PATH:?DUMP_PATH is required}"

if [ ! -r "$DUMP_PATH" ]; then
  echo "Dump path is not readable" >&2
  exit 1
fi

dump_dir="$(cd "$(dirname "$DUMP_PATH")" && pwd)"
dump_file="$(basename "$DUMP_PATH")"

docker run --rm \
  -v "$dump_dir:/dumps:ro" \
  postgres:16-alpine \
  pg_restore -l "/dumps/$dump_file"
