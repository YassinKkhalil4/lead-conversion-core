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
db_password, edge_secret, internal_secret = sys.argv[1:4]
text=text.replace('EDGE_POSTGRES_PASSWORD=replace-with-secret',f'EDGE_POSTGRES_PASSWORD={db_password}')
text=text.replace('DATABASE_URL=postgresql://lead_os_edge_app:replace-with-secret@127.0.0.1:5432/lead_os_edge',f'DATABASE_URL=postgresql://lead_os_edge_app:{db_password}@127.0.0.1:5432/lead_os_edge')
text=text.replace('EDGE_SHARED_SECRET=replace-with-at-least-16-chars',f'EDGE_SHARED_SECRET={edge_secret}',1)
text=text.replace('EDGE_INTERNAL_SECRET=replace-with-at-least-16-chars',f'EDGE_INTERNAL_SECRET={internal_secret}',1)
path.write_text(text)
PY
chmod 600 .env

echo "Created $(pwd)/.env with random database and service secrets."
echo "AIRTABLE_TOKEN remains blank intentionally."
