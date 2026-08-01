#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

patterns=(
  '(^|/)\.env($|\.)'
  '(^|/)node_modules/'
  '(^|/)dist/'
  '(^|/)coverage/'
  '(^|/)imports/'
  '(^|/)exports/'
  '(^|/)tmp/'
  '(^|/)persistent/'
  '(^|/)docker/'
  '(^|/)databases/'
  '\.dump$'
  '\.sql\.gz$'
  '\.tar$'
  '\.tar\.gz$'
  '\.tgz$'
  '\.zip$'
  'inspect.*\.json$'
  'compose-resolved.*\.ya?ml$'
  'all-n8n-credentials-encrypted\.json$'
  'credentials.*\.json$'
  'credential.*\.json$'
)

violations=""
while IFS= read -r path; do
  if [[ "$path" == ".env.example" ]]; then
    continue;
  fi
  for pattern in "${patterns[@]}"; do
    if [[ "$path" =~ $pattern ]]; then
      violations+="$path"$'\n'
      break
    fi
  done
done < <(git ls-files)

if [[ -n "$violations" ]]; then
  echo "Tracked artifact scan failed. Remove these paths from Git:" >&2
  printf '%s' "$violations" >&2
  exit 1
fi

echo "tracked_artifact_scan=pass"
