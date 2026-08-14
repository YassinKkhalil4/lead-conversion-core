#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
BASE=""
SKIP_READY="false"
CHECK_DIRECT_META="false"
CHECK_DIRECT_LEAD="false"
EXPECT_DIRECT_META=""
EXPECT_DIRECT_LEAD=""
SEEN_ENV_FILE="false"
SEEN_BASE_URL="false"
SEEN_SKIP_READY="false"
SEEN_CHECK_DIRECT_META="false"
SEEN_CHECK_DIRECT_LEAD="false"
SEEN_EXPECT_DIRECT_META="false"
SEEN_EXPECT_DIRECT_LEAD="false"

usage() {
  cat <<'USAGE'
Usage: scripts/verify-deployment.sh [options]

Options:
  --env-file=PATH                 Environment file to load without shell execution. Defaults to .env.
  --base-url=URL                  Edge base URL. Defaults to http://127.0.0.1:$EDGE_PORT.
  --skip-ready                    Skip /ready check.
  --check-direct-meta             Verify direct Meta challenge and POST behavior for the expected route state; enabled checks require Meta credentials.
  --check-direct-lead             Verify direct website and Facebook lead route behavior; enabled Facebook checks require META_APP_SECRET.
  --expect-direct-meta=MODE       MODE is enabled or disabled. Defaults from DIRECT_META_WEBHOOK_ENABLED.
  --expect-direct-lead=MODE       MODE is enabled or disabled. Defaults from DIRECT_LEAD_INGRESS_ENABLED.
USAGE
}

reject_duplicate_arg() {
  local name="$1"
  local seen="$2"
  if [[ "$seen" == "true" ]]; then
    echo "Duplicate verify-deployment argument: $name" >&2
    exit 2
  fi
}

validate_arg_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing verify-deployment argument: $name" >&2
    exit 2
  fi
  if [[ "$value" =~ [[:cntrl:]] ]]; then
    echo "Invalid verify-deployment argument: $name" >&2
    exit 2
  fi
}

for arg in "$@"; do
  case "$arg" in
    --env-file=*)
      reject_duplicate_arg "--env-file" "$SEEN_ENV_FILE"
      SEEN_ENV_FILE="true"
      ENV_FILE="${arg#--env-file=}"
      validate_arg_value "--env-file" "$ENV_FILE"
      ;;
    --base-url=*)
      reject_duplicate_arg "--base-url" "$SEEN_BASE_URL"
      SEEN_BASE_URL="true"
      BASE="${arg#--base-url=}"
      validate_arg_value "--base-url" "$BASE"
      ;;
    --skip-ready)
      reject_duplicate_arg "--skip-ready" "$SEEN_SKIP_READY"
      SEEN_SKIP_READY="true"
      SKIP_READY="true"
      ;;
    --check-direct-meta)
      reject_duplicate_arg "--check-direct-meta" "$SEEN_CHECK_DIRECT_META"
      SEEN_CHECK_DIRECT_META="true"
      CHECK_DIRECT_META="true"
      ;;
    --check-direct-lead)
      reject_duplicate_arg "--check-direct-lead" "$SEEN_CHECK_DIRECT_LEAD"
      SEEN_CHECK_DIRECT_LEAD="true"
      CHECK_DIRECT_LEAD="true"
      ;;
    --expect-direct-meta=*)
      reject_duplicate_arg "--expect-direct-meta" "$SEEN_EXPECT_DIRECT_META"
      SEEN_EXPECT_DIRECT_META="true"
      EXPECT_DIRECT_META="${arg#--expect-direct-meta=}"
      validate_arg_value "--expect-direct-meta" "$EXPECT_DIRECT_META"
      ;;
    --expect-direct-lead=*)
      reject_duplicate_arg "--expect-direct-lead" "$SEEN_EXPECT_DIRECT_LEAD"
      SEEN_EXPECT_DIRECT_LEAD="true"
      EXPECT_DIRECT_LEAD="${arg#--expect-direct-lead=}"
      validate_arg_value "--expect-direct-lead" "$EXPECT_DIRECT_LEAD"
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown verify-deployment argument" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

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

load_env_file "$ENV_FILE"

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

VERIFY_DEPLOYMENT_RUN_ID="${VERIFY_DEPLOYMENT_RUN_ID:-$(date +%s)-$$-${RANDOM:-0}}"

tmp_body="$(mktemp)"
tmp_edge_header="$(mktemp)"
tmp_meta_curl_config="$(mktemp)"
tmp_meta_post_config="$(mktemp)"
tmp_meta_unsigned_post_config="$(mktemp)"
tmp_meta_probe_body="$(mktemp)"
tmp_facebook_curl_config="$(mktemp)"
tmp_facebook_probe_body="$(mktemp)"
tmp_meta_secret_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_body" "$tmp_edge_header" "$tmp_meta_curl_config" "$tmp_meta_post_config" "$tmp_meta_unsigned_post_config" "$tmp_meta_probe_body" "$tmp_facebook_curl_config" "$tmp_facebook_probe_body" "$tmp_meta_secret_file"
}
trap cleanup EXIT
chmod 600 "$tmp_body" "$tmp_edge_header" "$tmp_meta_curl_config" "$tmp_meta_post_config" "$tmp_meta_unsigned_post_config" "$tmp_meta_probe_body" "$tmp_facebook_curl_config" "$tmp_facebook_probe_body" "$tmp_meta_secret_file"

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

write_signed_post_config() {
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

write_unsigned_post_config() {
  local file="$1"
  local url="$2"
  local body_file="$3"
  {
    printf 'url = "%s"\n' "$(curl_config_escape "$url")"
    printf 'request = "POST"\n'
    printf 'header = "Content-Type: application/json"\n'
    printf 'data-binary = "@%s"\n' "$(curl_config_escape "$body_file")"
  } > "$file"
}

hmac_sha256_signature() {
  local secret_file="$1"
  local body_file="$2"
  python3 - "$secret_file" "$body_file" <<'HMAC_PY'
import hashlib
import hmac
import sys
from pathlib import Path

secret = Path(sys.argv[1]).read_bytes()
body = Path(sys.argv[2]).read_bytes()
print("sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest())
HMAC_PY
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
  if [[ "$EXPECT_DIRECT_META" == "enabled" && -z "${META_WEBHOOK_VERIFY_TOKEN:-}" ]]; then
    echo "META_WEBHOOK_VERIFY_TOKEN is required for enabled --check-direct-meta" >&2
    exit 1
  fi
  meta_challenge_token="${META_WEBHOOK_VERIFY_TOKEN:-verify-deployment-disabled-token}"
  echo "Direct Meta challenge ($EXPECT_DIRECT_META):"
  challenge="verify-deployment-$VERIFY_DEPLOYMENT_RUN_ID"
  write_url_config "$tmp_meta_curl_config" "$BASE/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=$meta_challenge_token&hub.challenge=$challenge"
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

  cat > "$tmp_meta_probe_body" <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"verify-deployment-waba","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"verify-deployment-phone-number"}}}]}]}
JSON

  if [[ "$EXPECT_DIRECT_META" == "enabled" ]]; then
    if [[ -z "${META_APP_SECRET:-}" ]]; then
      echo "META_APP_SECRET is required for enabled --check-direct-meta signed webhook verification" >&2
      exit 1
    fi
    printf '%s' "$META_APP_SECRET" > "$tmp_meta_secret_file"
    signature="$(hmac_sha256_signature "$tmp_meta_secret_file" "$tmp_meta_probe_body")"
    write_signed_post_config "$tmp_meta_post_config" "$BASE/webhooks/meta/whatsapp" "$signature" "$tmp_meta_probe_body"
    echo "Direct Meta signed webhook ($EXPECT_DIRECT_META):"
    status="$(status_request --config "$tmp_meta_post_config")"
    assert_status "$status" "200" "Direct Meta signed webhook"
    if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$tmp_body"; then
      echo "Direct Meta signed webhook failed: receipt response did not include ok=true" >&2
      cat "$tmp_body" >&2 || true
      exit 1
    fi
    echo "ok"

    write_unsigned_post_config "$tmp_meta_unsigned_post_config" "$BASE/webhooks/meta/whatsapp" "$tmp_meta_probe_body"
    echo "Direct Meta unsigned webhook rejection:"
    status="$(status_request --config "$tmp_meta_unsigned_post_config")"
    assert_status "$status" "401" "Direct Meta unsigned webhook rejection"
    echo "ok"
  else
    write_unsigned_post_config "$tmp_meta_unsigned_post_config" "$BASE/webhooks/meta/whatsapp" "$tmp_meta_probe_body"
    echo "Direct Meta disabled webhook POST:"
    status="$(status_request --config "$tmp_meta_unsigned_post_config")"
    assert_status "$status" "503" "Disabled direct Meta webhook POST"
    echo "ok"
  fi
fi

if [[ "$CHECK_DIRECT_LEAD" == "true" ]]; then
  if [[ "$EXPECT_DIRECT_LEAD" == "enabled" && -z "${EDGE_SHARED_SECRET:-}" ]]; then
    echo "EDGE_SHARED_SECRET is required for enabled website --check-direct-lead" >&2
    exit 1
  fi
  if [[ "$EXPECT_DIRECT_LEAD" == "enabled" && -z "${META_APP_SECRET:-}" ]]; then
    echo "META_APP_SECRET is required for enabled Facebook --check-direct-lead" >&2
    exit 1
  fi
  if [[ -n "${EDGE_SHARED_SECRET:-}" ]]; then
    printf 'X-Edge-Secret: %s\n' "$EDGE_SHARED_SECRET" > "$tmp_edge_header"
  fi
  lead_status_request() {
    if [[ -n "${EDGE_SHARED_SECRET:-}" ]]; then
      status_request -H "@$tmp_edge_header" "$@"
    else
      status_request "$@"
    fi
  }
  echo "Direct website lead ingress ($EXPECT_DIRECT_LEAD):"
  event="verify-direct-website-lead-invalid-$VERIFY_DEPLOYMENT_RUN_ID"
  status="$(lead_status_request \
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
  event="verify-direct-facebook-lead-invalid-$VERIFY_DEPLOYMENT_RUN_ID"
  cat > "$tmp_facebook_probe_body" <<JSON
{
  "leadgen_id":"$event",
  "clientKey":"verify-deployment"
}
JSON
  if [[ "$EXPECT_DIRECT_LEAD" == "enabled" ]]; then
    printf '%s' "$META_APP_SECRET" > "$tmp_meta_secret_file"
    facebook_signature="$(hmac_sha256_signature "$tmp_meta_secret_file" "$tmp_facebook_probe_body")"
    write_signed_post_config "$tmp_facebook_curl_config" "$BASE/webhooks/leads/facebook" "$facebook_signature" "$tmp_facebook_probe_body"
    status="$(status_request --config "$tmp_facebook_curl_config")"
  else
    write_unsigned_post_config "$tmp_facebook_curl_config" "$BASE/webhooks/leads/facebook" "$tmp_facebook_probe_body"
    status="$(status_request --config "$tmp_facebook_curl_config")"
  fi
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
