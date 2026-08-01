#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
BASE=""
SKIP_READY="false"
SKIP_SHADOW="false"
CHECK_DIRECT_META="false"
CHECK_DIRECT_LEAD="false"
EXPECT_DIRECT_META=""
EXPECT_DIRECT_LEAD=""

usage() {
  cat <<'USAGE'
Usage: scripts/verify-deployment.sh [options]

Options:
  --env-file=PATH                 Environment file to source. Defaults to .env.
  --base-url=URL                  Edge base URL. Defaults to http://127.0.0.1:$EDGE_PORT.
  --skip-ready                    Skip /ready check.
  --skip-shadow                   Skip /v1/shadow/evaluate check.
  --check-direct-meta             Verify direct Meta challenge behavior and, when enabled, signed non-customer webhook receipt.
  --check-direct-lead             Verify direct website and Facebook lead route behavior with non-business durable-receipt probes.
  --expect-direct-meta=MODE       MODE is enabled or disabled. Defaults from DIRECT_META_WEBHOOK_ENABLED.
  --expect-direct-lead=MODE       MODE is enabled or disabled. Defaults from DIRECT_LEAD_INGRESS_ENABLED.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --env-file=*) ENV_FILE="${arg#--env-file=}" ;;
    --base-url=*) BASE="${arg#--base-url=}" ;;
    --skip-ready) SKIP_READY="true" ;;
    --skip-shadow) SKIP_SHADOW="true" ;;
    --check-direct-meta) CHECK_DIRECT_META="true" ;;
    --check-direct-lead) CHECK_DIRECT_LEAD="true" ;;
    --expect-direct-meta=*) EXPECT_DIRECT_META="${arg#--expect-direct-meta=}" ;;
    --expect-direct-lead=*) EXPECT_DIRECT_LEAD="${arg#--expect-direct-lead=}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"

BASE="${BASE:-http://127.0.0.1:${EDGE_PORT:-8080}}"
EXPECT_DIRECT_META="${EXPECT_DIRECT_META:-$([[ ${DIRECT_META_WEBHOOK_ENABLED:-false} == "true" ]] && echo enabled || echo disabled)}"
EXPECT_DIRECT_LEAD="${EXPECT_DIRECT_LEAD:-$([[ ${DIRECT_LEAD_INGRESS_ENABLED:-false} == "true" ]] && echo enabled || echo disabled)}"

if [[ "$EXPECT_DIRECT_META" != "enabled" && "$EXPECT_DIRECT_META" != "disabled" ]]; then
  echo "--expect-direct-meta must be enabled or disabled" >&2
  exit 2
fi
if [[ "$EXPECT_DIRECT_LEAD" != "enabled" && "$EXPECT_DIRECT_LEAD" != "disabled" ]]; then
  echo "--expect-direct-lead must be enabled or disabled" >&2
  exit 2
fi

tmp_body="$(mktemp)"
tmp_edge_header="$(mktemp)"
tmp_meta_curl_config="$(mktemp)"
tmp_meta_post_config="$(mktemp)"
tmp_meta_probe_body="$(mktemp)"
tmp_meta_secret_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_body" "$tmp_edge_header" "$tmp_meta_curl_config" "$tmp_meta_post_config" "$tmp_meta_probe_body" "$tmp_meta_secret_file"
}
trap cleanup EXIT
chmod 600 "$tmp_body" "$tmp_edge_header" "$tmp_meta_curl_config" "$tmp_meta_post_config" "$tmp_meta_probe_body" "$tmp_meta_secret_file"

status_request() {
  curl -sS -o "$tmp_body" -w "%{http_code}" "$@"
}

curl_config_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

write_url_config() {
  local file="$1"
  local url="$2"
  printf 'url = "%s"\n' "$(curl_config_escape "$url")" > "$file"
}

write_signed_meta_probe_config() {
  local file="$1"
  local url="$2"
  local signature="$3"
  local body_file="$4"
  {
    printf 'url = "%s"\n' "$(curl_config_escape "$url")"
    printf 'request = "POST"\n'
    printf 'header = "Content-Type: application/json"\n'
    printf 'header = "X-Hub-Signature-256: %s"\n' "$(curl_config_escape "$signature")"
    printf 'data-binary = "@%s"\n' "$(curl_config_escape "$body_file")"
  } > "$file"
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label failed: expected HTTP $expected, got $actual" >&2
    cat "$tmp_body" >&2 || true
    exit 1
  fi
}

echo "Health:"
curl -fsS "$BASE/health"
echo

if [[ "$SKIP_READY" != "true" ]]; then
  echo "Ready:"
  curl -fsS "$BASE/ready"
  echo
fi

if [[ "$CHECK_DIRECT_META" == "true" ]]; then
  if [[ -z "${META_WEBHOOK_VERIFY_TOKEN:-}" ]]; then
    echo "META_WEBHOOK_VERIFY_TOKEN is required for --check-direct-meta" >&2
    exit 1
  fi
  echo "Direct Meta challenge ($EXPECT_DIRECT_META):"
  challenge="verify-deployment-$(date +%s)"
  write_url_config "$tmp_meta_curl_config" "$BASE/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=$challenge"
  status="$(status_request --config "$tmp_meta_curl_config")"
  if [[ "$EXPECT_DIRECT_META" == "enabled" ]]; then
    assert_status "$status" "200" "Direct Meta challenge"
    if [[ "$(cat "$tmp_body")" != "$challenge" ]]; then
      echo "Direct Meta challenge failed: response body did not match challenge" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
  else
    assert_status "$status" "503" "Disabled direct Meta challenge"
  fi
  echo "ok"

  if [[ "$EXPECT_DIRECT_META" == "enabled" ]]; then
    if [[ -z "${META_APP_SECRET:-}" ]]; then
      echo "META_APP_SECRET is required for enabled --check-direct-meta signed webhook verification" >&2
      exit 1
    fi
    cat > "$tmp_meta_probe_body" <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"verify-deployment-waba","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"verify-deployment-phone-number"}}}]}]}
JSON
    printf '%s' "$META_APP_SECRET" > "$tmp_meta_secret_file"
    signature="$(python3 - "$tmp_meta_secret_file" "$tmp_meta_probe_body" <<'PY'
import hashlib
import hmac
import sys
from pathlib import Path

secret = Path(sys.argv[1]).read_bytes()
body = Path(sys.argv[2]).read_bytes()
print("sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest())
PY
)"
    write_signed_meta_probe_config "$tmp_meta_post_config" "$BASE/webhooks/meta/whatsapp" "$signature" "$tmp_meta_probe_body"
    echo "Direct Meta signed webhook ($EXPECT_DIRECT_META):"
    status="$(status_request --config "$tmp_meta_post_config")"
    assert_status "$status" "200" "Direct Meta signed webhook"
    if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$tmp_body"; then
      echo "Direct Meta signed webhook failed: receipt response did not include ok=true" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
    echo "ok"
  fi
fi

if [[ "$CHECK_DIRECT_LEAD" == "true" ]]; then
  if [[ -z "${EDGE_SHARED_SECRET:-}" ]]; then
    echo "EDGE_SHARED_SECRET is required for --check-direct-lead" >&2
    exit 1
  fi
  printf 'X-Edge-Secret: %s\n' "$EDGE_SHARED_SECRET" > "$tmp_edge_header"
  echo "Direct website lead ingress ($EXPECT_DIRECT_LEAD):"
  event="verify-direct-website-lead-invalid-$(date +%s)"
  status="$(status_request \
    -H "@$tmp_edge_header" \
    -H 'Content-Type: application/json' \
    -d "{
      \"eventId\":\"$event\",
      \"clientKey\":\"verify-deployment\"
    }" \
    "$BASE/webhooks/leads/website")"
  if [[ "$EXPECT_DIRECT_LEAD" == "enabled" ]]; then
    if [[ "$status" != "200" ]]; then
      echo "Direct website lead ingress failed: expected enabled durable receipt HTTP 200, got $status" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
    if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$tmp_body"; then
      echo "Direct website lead ingress failed: receipt response did not include ok=true" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
  else
    assert_status "$status" "503" "Disabled direct website lead ingress"
  fi
  echo "ok"

  echo "Direct Facebook lead ingress ($EXPECT_DIRECT_LEAD):"
  event="verify-direct-facebook-lead-invalid-$(date +%s)"
  status="$(status_request \
    -H "@$tmp_edge_header" \
    -H 'Content-Type: application/json' \
    -d "{
      \"leadgen_id\":\"$event\",
      \"clientKey\":\"verify-deployment\"
    }" \
    "$BASE/webhooks/leads/facebook")"
  if [[ "$EXPECT_DIRECT_LEAD" == "enabled" ]]; then
    if [[ "$status" != "200" ]]; then
      echo "Direct Facebook lead ingress failed: expected enabled durable receipt HTTP 200, got $status" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
    if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$tmp_body"; then
      echo "Direct Facebook lead ingress failed: receipt response did not include ok=true" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
  else
    assert_status "$status" "503" "Disabled direct Facebook lead ingress"
  fi
  echo "ok"
fi

if [[ "$SKIP_SHADOW" != "true" ]]; then
  if [[ -z "${EDGE_SHARED_SECRET:-}" ]]; then
    echo "EDGE_SHARED_SECRET is required for shadow verification" >&2
    exit 1
  fi
  printf 'X-Edge-Secret: %s\n' "$EDGE_SHARED_SECRET" > "$tmp_edge_header"
  PHONE="+2010$(date +%H%M%S)00"
  EVENT="verify-$(date +%s)-1"

  echo "First shadow evaluation:"
  curl -fsS \
    -H "@$tmp_edge_header" \
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
fi
