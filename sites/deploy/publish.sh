#!/usr/bin/env bash
# Publishes the three Kadensio sites. Kadensio only: it never touches Rolefit,
# BCN, or the app/core blocks in kadensio.caddy.
#
#   publish.sh stage      copy built sites into new release dirs (nothing live changes)
#   publish.sh golive     install Caddy config, reload, verify (needs DNS first)
#   publish.sh rollback   restore the previous Caddy files and the old landing
#
# Build first:  docker run --rm -v "$PWD":/app -w /app node:22-bookworm \
#                 sh -c 'SITES_INDEXABLE=1 node sites/build.mjs && node sites/check.mjs'
set -euo pipefail
cd "$(dirname "$0")/../.."
STAMP=$(date -u +%Y%m%d-%H%M%S)
STATE=/var/www/.kadensio-publish-state
declare -A SRC=( [kadensio-root]=sites/dist/root [kadensio-real-estate]=sites/dist/real-estate-landing [kadensio-hospitality]=sites/dist/hospitality )

stage() {
  for name in "${!SRC[@]}"; do
    base=/var/www/$name; rel=$base/releases/$STAMP
    [ -f "${SRC[$name]}/index.html" ] || { echo "missing build: ${SRC[$name]}"; exit 1; }
    mkdir -p "$rel"; cp -r "${SRC[$name]}/." "$rel/"; chown -R caddy:caddy "$base"
    ln -sfn "$rel" "$base/current.tmp"; mv -Tf "$base/current.tmp" "$base/current"
    echo "staged $name -> $rel"
  done
}

golive() {
  for h in real-estate hospitality; do
    ip=$(dig +short A $h.kadensio.com | head -1); me=$(hostname -I | awk '{print $1}')
    [ "$ip" = "$me" ] || { echo "DNS for $h.kadensio.com is '$ip', expected $me. Add the A record first."; exit 1; }
  done
  mkdir -p "$STATE/$STAMP"; cp /etc/caddy/sites/kadensio.caddy "$STATE/$STAMP/kadensio.caddy"
  echo "$STAMP" > "$STATE/latest"
  cp sites/deploy/kadensio-verticals.caddy /etc/caddy/sites/kadensio-verticals.caddy
  # Replace only the kadensio.com block; the (kadensio_app) snippet and app/core blocks stay as they are.
  python3 - <<'PY'
import re
p='/etc/caddy/sites/kadensio.caddy'
s=open(p).read()
new=open('sites/deploy/kadensio-root.caddy').read().split('\n\n',1)[1]
m=re.search(r'kadensio\.com, www\.kadensio\.com \{.*?\n\}\n', s, re.S)
assert m, 'kadensio.com block not found'
open(p,'w').write(s[:m.start()]+new.rstrip('\n')+'\n'+s[m.end():])
PY
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { echo "caddy config invalid, restoring"; rollback; exit 1; }
  systemctl reload caddy
  echo "caddy reloaded"
}

rollback() {
  last=$(cat "$STATE/latest"); cp "$STATE/$last/kadensio.caddy" /etc/caddy/sites/kadensio.caddy
  rm -f /etc/caddy/sites/kadensio-verticals.caddy
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy && echo "restored previous Caddy files (old landing serves kadensio.com)"
}

"$@"
