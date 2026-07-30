#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
source .env
set +a

BASE="http://127.0.0.1:${EDGE_PORT:-8080}"

echo "Health:"
curl -fsS "$BASE/health"
echo

echo "Ready:"
curl -fsS "$BASE/ready"
echo

PHONE="+2010$(date +%H%M%S)00"
EVENT="verify-$(date +%s)-1"

echo "First shadow evaluation:"
curl -fsS \
  -H "X-Edge-Secret: $EDGE_SHARED_SECRET" \
  -H 'Content-Type: application/json' \
  -d "{
    \"eventId\":\"$EVENT\",
    \"metaMessageId\":\"wamid.$EVENT\",
    \"clientRecordId\":\"recSHADOWCLIENT01\",
    \"clientId\":\"shadow_test\",
    \"phoneNormalized\":\"$PHONE\",
    \"leadRecordId\":\"recSHADOWLEAD001\",
    \"leadName\":\"Ahmed\",
    \"companyName\":\"Demo Realty\",
    \"projectName\":\"Palm Heights\",
    \"messageText\":\"hello\"
  }" \
  "$BASE/v1/shadow/evaluate" \
  | python3 -m json.tool
