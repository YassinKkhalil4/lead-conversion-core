// Builds the three marketing sites into sites/dist/<site>/. No dependencies.
//
//   node sites/build.mjs                 # noindex build, safe to preview
//   SITES_INDEXABLE=1 node sites/build.mjs   # launch build
//
// The host has no Node; run it in a container:
//   docker run --rm -v "$PWD":/app -w /app node:22-bookworm node sites/build.mjs

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import root from "./copy/root.mjs";
import realEstate from "./copy/real-estate.mjs";
import hospitality from "./copy/hospitality.mjs";
import { gatewayBar, hero, ledger, mappingTable, page, pipeline, section, rootHeader, verticalHeader } from "./shared/ui.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dist = join(here, "dist");
const indexable = process.env.SITES_INDEXABLE === "1";

/** Keep only nav links whose target id exists in the rendered main. */
const liveNav = (nav, main) => nav.filter((n) => !n.href.startsWith("#") || main.includes(`id="${n.href.slice(1)}"`));

function rootPage() {
  const s = root;
  const main = [
    hero(s, { gateways: true }),
    section({ ...s.architecture, body: pipeline(s.architecture.steps), tint: true }),
    section({ ...s.guarantees, body: ledger(s.guarantees.rows) }),
    section({ ...s.verticals, body: mappingTable(s.verticals), tint: true }),
  ].join("\n");
  return page(s, { indexable, header: rootHeader(s, liveNav(s.nav, main)), main, extraBody: gatewayBar(), bodyClass: "has-gateway-bar" });
}

function verticalPage(s) {
  const main = hero(s);
  return page(s, { indexable, header: verticalHeader(s, liveNav(s.nav, main)), main });
}

const sites = [
  ["root", rootPage()],
  ["real-estate", verticalPage(realEstate)],
  ["hospitality", verticalPage(hospitality)],
];

const css = ["base.css", "components.css"].map((f) => readFileSync(join(here, "shared", f), "utf8")).join("\n");

rmSync(dist, { recursive: true, force: true });
for (const [id, html] of sites) {
  const out = join(dist, id);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), html);
  writeFileSync(join(out, "styles.css"), css);
  // Fonts and logo marks come from the live landing, so there is one copy of the brand.
  cpSync(join(repo, "landing", "assets", "fonts"), join(out, "assets", "fonts"), { recursive: true });
  for (const f of ["kadensio-lockup.svg", "kadensio-lockup-reversed.svg", "kadensio-icon.svg", "kadensio-icon-small.svg"]) {
    cpSync(join(repo, "landing", "assets", f), join(out, "assets", f));
  }
  writeFileSync(
    join(out, "robots.txt"),
    indexable ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n",
  );
}

console.log(`built ${sites.map(([id]) => id).join(", ")} (${indexable ? "indexable" : "noindex"}) -> sites/dist`);
