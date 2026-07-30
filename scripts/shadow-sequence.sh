#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
source .env
set +a

BASE="http://127.0.0.1:${EDGE_PORT:-8080}"
PHONE="+2010$(date +%H%M%S)11"
CLIENT="recSHADOWCLIENT01"
LEAD="recSHADOWLEAD001"
COUNTER=0

post_turn() {
  local text="${1:-}"
  local option="${2:-}"
  COUNTER=$((COUNTER+1))
  local event="sequence-$(date +%s)-$COUNTER"
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
    -H "X-Edge-Secret: $EDGE_SHARED_SECRET" \
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
