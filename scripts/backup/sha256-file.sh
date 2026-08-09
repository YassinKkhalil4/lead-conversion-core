#!/bin/sh
set -eu

: "${1:?file path is required}"

file_path="$1"

if [ ! -r "$file_path" ]; then
  echo "File is not readable for checksum: $file_path" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$file_path" | awk '{print $1}'
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$file_path" | awk '{print $1}'
else
  echo "No SHA-256 checksum tool found; install sha256sum or shasum" >&2
  exit 1
fi
