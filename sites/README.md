# Marketing sites

Three static sites, one shared shell. Frontend only: nothing here touches `src/`, `migrations/` or the backend.

| Site | Output | Domain |
|---|---|---|
| root | `dist/root` | kadensio.com |
| real-estate | `dist/real-estate` | real-estate.kadensio.com |
| hospitality | `dist/hospitality` | hospitality.kadensio.com |

```
CLAIMS.md  hospitality claims the owner must confirm before launch
copy/      text only, one file per site, plus shared.mjs (URLs, verticals, wording rule)
shared/    base.css (forked from landing/styles.css), components.css, ui.mjs (header, footer, hero, sections)
build.mjs  renders the three sites into dist/ (no dependencies)
check.mjs  invariants: no dead anchors, gateways, backlinks, vocabulary and overclaim checks,
           and the real-estate scoring arithmetic (example sums to its score, factor maxima to 123)
```

## Build and check

The host has no Node.

```
docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'node sites/build.mjs && node sites/check.mjs'
```

The default build is `noindex` with a `Disallow: /` robots.txt. Launch with `SITES_INDEXABLE=1`.

## Rules

- Components never hold copy. Text lives in `copy/`.
- A nav link is rendered only if its section exists on the page.
- Fonts and logos are read from `landing/assets`, so there is one copy of the brand.
- Wording: no generative model decides, writes or prices anything. Do not claim "no models" (voice uses speech recognition and synthesis) or that bans are impossible.

## Not done yet

- The full root FAQ.
- Hospitality is written through step 3 (mechanics, reservation sequence, voice, dashboard, FAQ, closing) but unconfirmed: the backend has no voice, floor-plan or Catalan code. `CLAIMS.md` lists every claim, and `SITES_INDEXABLE=1` is refused until `claimsConfirmed` is `true` in `copy/hospitality.mjs`.
- Real estate is complete through step 2: mechanics, the nine questions, scoring (real_estate_v1 numbers, from `landing/lead-scoring.html`), dashboard, FAQ, closing. If the scoring model changes, change `copy/real-estate.mjs` and run `check.mjs`.
- Caddy blocks, DNS and release directories for the two subdomains. Nothing is deployed and `landing/` still serves kadensio.com.
- The dashboard re-label layer (tenant profile).
