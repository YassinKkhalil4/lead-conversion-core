// Invariants for the three sites. Run after build.mjs; exits non-zero on failure.
//   docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'node sites/build.mjs && node sites/check.mjs'

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import realEstate from "./copy/real-estate.mjs";
import { ORIGINS, PLATFORM_LABEL, PLATFORM_URL } from "./copy/shared.mjs";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const read = (site) => readFileSync(join(dist, site, "index.html"), "utf8");

for (const site of ["root", "real-estate", "hospitality"]) {
  const html = read(site);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
    check(ids.has(target), `${site}: dead anchor #${target}`);
  }
  check(/<meta name="robots"/.test(html), `${site}: missing robots meta`);
  check(/<h1>/.test(html) && (html.match(/<h1>/g) ?? []).length === 1, `${site}: needs exactly one h1`);
  check(existsSync(join(dist, site, "assets/fonts/Geist-Variable.woff2")), `${site}: font missing`);
}

// Both gateways on the root: header, hero, mobile bar, footer.
const root = read("root");
for (const v of ["real-estate", "hospitality"]) {
  const n = root.split(`href="${ORIGINS[v]}"`).length - 1;
  check(n >= 4, `root: ${v} gateway appears ${n} times, expected at least 4`);
}

// Every vertical links back to the platform in the header and the footer.
for (const v of ["real-estate", "hospitality"]) {
  const html = read(v);
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
  for (const [name, part] of [["header", header], ["footer", footer]]) {
    check(part.includes(`href="${PLATFORM_URL}"`) && part.includes(PLATFORM_LABEL), `${v}: ${name} backlink missing`);
  }
  // Vocabulary must not leak across verticals.
  const other = v === "real-estate" ? /\b(reservation|guest|restaurant|table)s?\b/i : /\b(lead|broker|viewing|brokerage)s?\b/i;
  const text = html.replace(/<(footer|header)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ");
  check(!other.test(text), `${v}: other vertical's vocabulary in page body`);
}

// Claims we cannot make: voice needs speech models, official APIs do not make bans impossible.
for (const site of ["root", "real-estate", "hospitality"]) {
  check(!/zero.hallucination|completely eliminate|no (llm|ai)s? anywhere/i.test(read(site)), `${site}: overclaim wording`);
}

// Real estate scoring: the page must agree with its own arithmetic.
{
  const sc = realEstate.scoring;
  const sum = sc.example.reduce((n, [, pts]) => n + pts, 0);
  check(sum === sc.exampleScore, `real-estate: worked example sums to ${sum}, page says ${sc.exampleScore}`);
  const maxes = sc.factors.map(([, pts]) => Math.max(...pts.match(/\d+/g).map(Number)));
  const total = maxes.reduce((a, b) => a + b, 0);
  check(total === 123, `real-estate: factor maximums sum to ${total}, page says 123`);
  check(sc.factors.length === 10 && sc.example.length === 10, "real-estate: expected ten factors");
  const exampleNames = sc.example.map(([n]) => n).join("|");
  check(exampleNames === sc.factors.map(([n]) => n).join("|"), "real-estate: example factors differ from the factor table");
  const html = read("real-estate");
  check(html.includes(">99<"), "real-estate: worked-example score missing from page");
  for (const [name, range] of sc.bands) {
    check(html.includes(`<strong>${name}</strong><span>${range}</span>`), `real-estate: band ${name} missing from page`);
  }
  check((html.match(/<li>/g) ?? []).length >= 9 + 6, "real-estate: questions or steps missing");
  check(existsSync(join(dist, "real-estate/assets/product-queue-1280.jpg")), "real-estate: screenshot missing");
}

if (failures.length) { console.error(failures.map((f) => `FAIL ${f}`).join("\n")); process.exit(1); }
console.log("sites: all checks passed");
