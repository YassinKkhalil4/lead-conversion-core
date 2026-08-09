#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

load_env_file() {
  local file="$1"
  local tmp_assignments
  tmp_assignments="$(mktemp)"
  chmod 600 "$tmp_assignments"
  if ! python3 scripts/ops/read-env-file.py "$file" > "$tmp_assignments"; then
    rm -f "$tmp_assignments"
    return 1
  fi
  while IFS= read -r -d '' assignment; do
    export "$assignment"
  done < "$tmp_assignments"
  rm -f "$tmp_assignments"
}

load_env_file .env

tmp_edge_header="$(mktemp)"
cleanup() {
  rm -f "$tmp_edge_header"
}
trap cleanup EXIT
chmod 600 "$tmp_edge_header"
printf 'X-Edge-Secret: %s\n' "$EDGE_SHARED_SECRET" > "$tmp_edge_header"

BASE="http://127.0.0.1:${EDGE_PORT:-8080}"
PHONE="+2010$(date +%H%M%S)11"
CLIENT="recSHADOWCLIENT01"
LEAD="recSHADOWLEAD001"
COUNTER=0
SHADOW_SEQUENCE_RUN_ID="${SHADOW_SEQUENCE_RUN_ID:-$(date +%s)-$$-${RANDOM:-0}}"

post_turn() {
  local text="${1:-}"
  local option="${2:-}"
  COUNTER=$((COUNTER+1))
  local event="sequence-$SHADOW_SEQUENCE_RUN_ID-$COUNTER"
  local payload
  payload="$(python3 - "$event" "$CLIENT" "$PHONE" "$LEAD" "$text" "$option" <<'PY'
import json,sys
p={
 'eventId':sys.argv[1], 'metaMessageId':'wamid.'+sys.argv[1],
 'clientRecordId':sys.argv[2], 'clientId':'shadow_test',
 'phoneNormalized':sys.argv[3], 'leadRecordId':sys.argv[4],
 'leadName':'Ahmed','companyName':'Demo Realty','projectName':'Palm Heights'
}
if sys.argv[5]: p['messageText']=sys.argv[5]
if sys.argv[6]: p['messageOptionId']=sys.argv[6]
print(json.dumps(p))
PY
)"
  curl -fsS \
    -H "@$tmp_edge_header" \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    "$BASE/v1/shadow/evaluate" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); x=d['decision']; print(json.dumps({'durationMs':d['durationMs'],'action':x['action'],'replyKey':x['replyKey'],'stageBefore':x['stageBefore'],'stageAfter':x['stageAfter'],'parsedValue':x.get('parsedValue'),'text':x['text']},ensure_ascii=False,indent=2))"
}

post_turn "hello" ""
post_turn "" "lang_en"
post_turn "" "perm_yes"
post_turn "New Cairo" ""
post_turn "" "unit_villa"
post_turn "" "budget_3_5"
post_turn "" "pay_cash"
post_turn "" "tl_now"
post_turn "" "pur_residence"
post_turn "" "sv_no"
