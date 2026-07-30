#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo "Refusing to overwrite existing .env" >&2
  exit 1
fi

DB_PASSWORD="$(openssl rand -hex 32)"
EDGE_SECRET="$(openssl rand -hex 32)"
INTERNAL_SECRET="$(openssl rand -hex 32)"

cp .env.example .env
python3 - "$DB_PASSWORD" "$EDGE_SECRET" "$INTERNAL_SECRET" <<'PY'
from pathlib import Path
import sys
path=Path('.env')
text=path.read_text()
text=text.replace('CHANGE_ME_LONG_RANDOM_PASSWORD',sys.argv[1])
text=text.replace('CHANGE_ME_64_HEX',sys.argv[2],1)
text=text.replace('CHANGE_ME_DIFFERENT_64_HEX',sys.argv[3],1)
path.write_text(text)
PY
chmod 600 .env

echo "Created $(pwd)/.env with random database and service secrets."
echo "AIRTABLE_TOKEN remains blank intentionally."
