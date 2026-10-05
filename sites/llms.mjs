// llms.txt and llms-full.txt for the three Kadensio sites (llmstxt.org).
//
//   llms.txt       a short, curated index: what the site is, where each page is
//   llms-full.txt  the complete text of every page, generated from the BUILT html,
//                  so it can never say something the page does not
//
// No dependencies. Runs inside build.mjs, before fingerprinting.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEGAL } from "./landing.mjs";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rarr: "→", larr: "←", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·", times: "×" };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const SKIP = new Set(["script", "style", "svg", "noscript", "picture", "button", "form", "iframe"]);
const BLOCK = new Set(["p", "div", "section", "ul", "ol", "dl", "figure", "figcaption", "details", "article", "blockquote", "header", "footer", "aside"]);

/** The page's <main>, as Markdown. Headings, paragraphs, lists, tables, FAQ, links. */
export function htmlToMarkdown(html, { origin }) {
  const m = html.match(/<main[\s\S]*?<\/main>/);
  const src = (m ? m[0] : html).replace(/<!--[\s\S]*?-->/g, "").replace(/<\/strong>\s*<span>/g, "</strong>: <span>");
  const out = [];
  const stack = [];
  let skip = 0;
  let table = null;
  let cell = null;
  let link = null;
  const push = (t) => (cell ? cell.push(t) : out.push(t));

  for (const tok of src.split(/(<[^>]+>)/)) {
    if (!tok) continue;
    if (!tok.startsWith("<")) {
      if (!skip) push(decode(tok).replace(/\s+/g, " "));
      continue;
    }
    const closing = tok[1] === "/";
    const name = tok.match(/^<\/?([a-z0-9]+)/i)?.[1].toLowerCase();
    if (!name) continue;
    if (SKIP.has(name)) {
      skip += closing ? -1 : tok.endsWith("/>") ? 0 : 1;
      continue;
    }
    if (skip) continue;
    const attr = (a) => decode(tok.match(new RegExp(`${a}="([^"]*)"`))?.[1] ?? "");

    if (!closing) {
      if (/^h[1-4]$/.test(name) || name === "summary") out.push(`\n\n${"#".repeat(name === "summary" ? 3 : +name[1])} `);
      else if (name === "li") out.push("\n- ");
      else if (name === "dt") out.push("\n- **");
      else if (name === "dd") out.push("**: ");
      else if (name === "table") table = [];
      else if (name === "tr" && table) table.push([]);
      else if (name === "td" || name === "th") cell = [];
      else if (name === "strong" || name === "b") push("**");
      else if (name === "em" || name === "i") push("*");
      else if (name === "a") {
        const href = attr("href");
        link = href && !href.startsWith("#") ? href : null;
        if (link) push("[");
      } else if (name === "br") out.push("\n");
      else if (name === "img" && attr("alt")) push(`(image: ${attr("alt")})`);
      else if (BLOCK.has(name)) out.push("\n\n");
      stack.push(name);
    } else {
      stack.pop();
      if (/^h[1-4]$/.test(name) || name === "summary") out.push("\n\n");
      else if (name === "dt") out.push("");
      else if (name === "td" || name === "th") {
        table?.at(-1)?.push(cell.join("").trim().replace(/\|/g, "\\|"));
        cell = null;
      } else if (name === "table" && table) {
        const w = Math.max(...table.map((r) => r.length));
        const rows = table.filter((r) => r.length).map((r) => `| ${[...r, ...Array(w - r.length).fill("")].join(" | ")} |`);
        if (rows.length) out.push(`\n\n${[rows[0], `| ${Array(w).fill("---").join(" | ")} |`, ...rows.slice(1)].join("\n")}\n\n`);
        table = null;
      } else if (name === "strong" || name === "b") push("**");
      else if (name === "em" || name === "i") push("*");
      else if (name === "a") {
        if (link) push(`](${new URL(link, origin).href})`);
        link = null;
      } else if (BLOCK.has(name)) out.push("\n");
    }
  }
  return out
    .join("")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]\(/g, "](")
    .replace(/^(#+ )(\d{2})(?=[A-Za-z])/gm, "$1$2. ")
    .trim();
}

const meta = (html, re) => decode(html.match(re)?.[1] ?? "").trim();
const titleOf = (html) => meta(html, /<title>([^<]*)<\/title>/);
const descriptionOf = (html) => meta(html, /<meta name="description" content="([^"]*)"/);
const read = (dir, f) => readFileSync(join(dir, f), "utf8");

/** One page as a section of a larger file: its title, address, description, then its text. */
function pageSection(dir, file, origin, level = 2) {
  const html = read(dir, file);
  const url = `${origin}/${file === "index.html" ? "" : file}`;
  const body = htmlToMarkdown(html, { origin }).replace(/^#{1,4} /gm, (h) => `${"#".repeat(Math.min(h.trim().length + level, 6))} `);
  return [`${"#".repeat(level)} ${titleOf(html)}`, `*Page: ${url}*`, descriptionOf(html) && `> ${descriptionOf(html)}`, body].filter(Boolean).join("\n\n");
}

const joinDocs = (parts) => `${parts.join("\n\n---\n\n")}\n`;

/**
 * Writes llms.txt and llms-full.txt into `out`.
 *
 *   site     { name, origin, summary, intro[], pages: [{ file, label, note }], related: [{label,url,note}], contact }
 *   fullExtra  other built sites to append in full, [{ dir, origin, pages: [file] }]
 */
export function writeLlms(out, site, fullExtra = [], { keepShort = false } = {}) {
  const { origin } = site;
  const link = (p) => `- [${p.label}](${origin}/${p.file === "index.html" ? "" : p.file}): ${p.note}`;
  const short = [
    `# ${site.name}`,
    `> ${site.summary}`,
    site.intro.join("\n\n"),
    "## Pages",
    site.pages.filter((p) => existsSync(join(out, p.file))).map(link).join("\n"),
    site.related?.length && `## Related\n\n${site.related.map((r) => `- [${r.label}](${r.url}): ${r.note}`).join("\n")}`,
    "## Optional",
    [`- [Full text of every page in one file](${origin}/llms-full.txt)`, `- [Sitemap](${origin}/sitemap.xml)`].join("\n"),
    `## Contact\n\n- ${site.contact}`,
  ].filter(Boolean);
  if (keepShort) {
    // The page-by-page llms.txt is hand-written source (landing/llms.txt); only point it at the full file.
    const existing = readFileSync(join(out, "llms.txt"), "utf8").trimEnd();
    const optional = short.slice(short.indexOf("## Optional"), short.indexOf("## Optional") + 2);
    writeFileSync(join(out, "llms.txt"), `${existing}\n\n${optional.join("\n\n")}\n`);
  } else {
    writeFileSync(join(out, "llms.txt"), `${short.join("\n\n")}\n`);
  }

  const sections = site.pages.filter((p) => existsSync(join(out, p.file))).map((p) => pageSection(out, p.file, origin));
  for (const x of fullExtra) for (const f of x.pages) sections.push(pageSection(x.dir, f, x.origin));
  const head = [
    `# ${site.name}: complete text`,
    `> ${site.summary}`,
    `This file holds the full text of every page below, generated from the published pages, so it matches them. A shorter index is at ${origin}/llms.txt. Contact: ${site.contact}`,
  ].join("\n\n");
  writeFileSync(join(out, "llms-full.txt"), joinDocs([head, ...sections]));
}

export { LEGAL };
