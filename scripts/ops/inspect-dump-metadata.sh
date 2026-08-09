#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  echo "inspect-dump-metadata.sh does not accept arguments" >&2
  exit 2
fi

: "${DUMP_PATH:?DUMP_PATH is required}"
POSTGRES_DOCKER_IMAGE="${POSTGRES_DOCKER_IMAGE:-postgres:16-alpine}"

if [ ! -r "$DUMP_PATH" ]; then
  echo "Dump path is not readable" >&2
  exit 1
fi

dump_dir="$(cd "$(dirname "$DUMP_PATH")" && pwd)"
dump_file="$(basename "$DUMP_PATH")"

docker run --rm \
  -v "$dump_dir:/dumps:ro" \
  "$POSTGRES_DOCKER_IMAGE" \
  pg_restore -l "/dumps/$dump_file"
