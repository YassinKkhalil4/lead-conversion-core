#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: sha256-file.sh FILE" >&2
  exit 2
fi

file_path="$1"
newline='
'
carriage_return="$(printf '\r')"
tab="$(printf '\t')"

case "$file_path" in
  ""|*"$newline"*|*"$carriage_return"*|*"$tab"*)
    echo "Invalid checksum file path" >&2
    exit 2
    ;;
esac

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
