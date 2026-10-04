// Content-hashed file names, so a cache can never serve a stale stylesheet or
// asset against newer HTML.
//
// Before this, styles.css and assets/* kept fixed names. Cloudflare gave the
// stylesheet a 4 hour browser cache and the assets were "immutable for a year",
// so after a deploy a returning visitor could hold old CSS with new markup and
// see a half-styled page. A name that changes whenever the bytes change makes
// that impossible: new content is a URL no cache has seen.
//
// The unhashed files stay in place (served with no-cache) so a cached page or an
// external link to the old address does not 404.

import { createHash } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
const withHash = (name, h) => name.replace(/(\.[A-Za-z0-9]+)$/, `.${h}$1`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Rewrites every reference in `text` found in `map` (old relative path -> new). */
function rewrite(text, map) {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const re = new RegExp(`(${keys.map(esc).join("|")})(?![A-Za-z0-9_-])`, "g");
  return text.replace(re, (m) => map[m]);
}

export function fingerprint(dir) {
  // 1. Binary and font assets.
  const assetMap = {};
  const assetsDir = join(dir, "assets");
  for (const file of walk(assetsDir)) {
    const rel = relative(dir, file).split(sep).join("/");
    if (/\.[0-9a-f]{10}\.[A-Za-z0-9]+$/.test(rel)) continue; // already hashed
    const hashed = withHash(rel, hash(readFileSync(file)));
    copyFileSync(file, join(dir, hashed));
    assetMap[rel] = hashed;
  }

  // 2. Stylesheets: point their url()s at hashed assets first, then hash the result.
  const cssMap = {};
  for (const name of ["styles.css", "legal.css"]) {
    const file = join(dir, name);
    try {
      statSync(file);
    } catch {
      continue;
    }
    const css = rewrite(readFileSync(file, "utf8"), assetMap);
    const hashed = withHash(name, hash(css));
    writeFileSync(join(dir, hashed), css);
    cssMap[name] = hashed;
  }

  // 3. Everything that links to them.
  const textFiles = walk(dir).filter((f) => /\.(html|xml|txt)$/.test(f) && !f.includes(`${sep}assets${sep}`));
  for (const file of textFiles) {
    let text = readFileSync(file, "utf8");
    text = rewrite(text, assetMap);
    for (const [from, to] of Object.entries(cssMap)) text = text.split(`href="${from}"`).join(`href="${to}"`);
    writeFileSync(file, text);
  }
  return { assets: Object.keys(assetMap).length, css: Object.values(cssMap) };
}
