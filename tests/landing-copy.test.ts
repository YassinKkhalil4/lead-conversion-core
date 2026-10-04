import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LANDING = join(process.cwd(), 'landing');
const ORIGIN = 'https://kadensio.com';

// Pages whose copy is marketing or editorial. The legal pages are contract text.
const COPY_PAGES = [
  'index.html',
  'lead-scoring.html',
  'official-vs-unofficial-whatsapp-automation.html',
  'speed-to-lead-real-estate.html',
];
const ALL_PAGES = readdirSync(LANDING).filter((file) => file.endsWith('.html')).sort();

const read = (file: string) => readFileSync(join(LANDING, file), 'utf8');

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"');
}

/** Visible prose only: no scripts, styles, comments or tags. */
function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

const normalise = (text: string) =>
  decode(text).replace(/\u2011/g, '-').replace(/\s+/g, ' ').trim();

// Filler the brand voice rules and the editing pass strip out.
const BANNED = [
  'seamless', 'seamlessly', 'revolutionary', 'next-generation', 'next generation',
  'game-changing', 'game changer', 'cutting-edge', 'state-of-the-art', 'effortless',
  'effortlessly', 'powerful', 'robust', 'leverage', 'unlock', 'supercharge',
  'streamline', 'delve', 'elevate', 'empower', 'best-in-class', 'world-class',
  'holistic', 'synergy', 'in today\'s fast-paced', 'ai-powered', 'ai-driven',
  'artificial intelligence', 'intelligent', 'learns from',
];

describe.each(COPY_PAGES)('%s copy', (file) => {
  const text = visibleText(read(file)).toLowerCase();

  it('uses none of the banned filler words', () => {
    const found = BANNED.filter((word) => text.includes(word));
    expect(found).toEqual([]);
  });

  it('never calls the product AI or a bot', () => {
    expect(text).not.toMatch(/\bai\b/);
    expect(text).not.toMatch(/\bbots?\b/);
  });

  it('has no exclamation marks, em dashes or emoji', () => {
    expect(text).not.toContain('!');
    expect(text).not.toMatch(/[\u2014\u2013]/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('keeps one h1, a title that fits a result and a description that fits a snippet', () => {
    const html = read(file);
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(title.length).toBeGreaterThan(20);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(160);
  });
});

describe('call to action wording', () => {
  it.each(ALL_PAGES)('%s uses one label for each action', (file) => {
    const html = read(file);
    expect(html).not.toMatch(/Request early access/i);
    expect(html).not.toContain('Message the live number');
  });
});

describe('home page FAQ', () => {
  const html = read('index.html');

  it('matches its FAQPage structured data, question for question', () => {
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!);
    const faq = (ld['@graph'] as Array<{ '@type': string; mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }> }>)
      .find((node) => node['@type'] === 'FAQPage');
    const structured = (faq?.mainEntity ?? []).map((q) => [normalise(q.name), normalise(q.acceptedAnswer.text)]);

    const visible = [...html.matchAll(/<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)]
      .map((m) => [normalise(m[1]!.replace(/<[^>]+>/g, '')), normalise(m[2]!.replace(/<[^>]+>/g, ''))]);

    expect(visible.length).toBeGreaterThanOrEqual(8);
    expect(structured).toEqual(visible);
  });
});

describe('site wiring', () => {
  const sitemap = readFileSync(join(LANDING, 'sitemap.xml'), 'utf8');
  const llms = readFileSync(join(LANDING, 'llms.txt'), 'utf8');
  const urlFor = (file: string) => (file === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${file}`);

  it.each(ALL_PAGES)('%s is canonical, in the sitemap and, if editorial, in llms.txt', (file) => {
    const html = read(file);
    if (file !== 'index.html') {
      expect(html).toContain(`<link rel="canonical" href="${urlFor(file)}">`);
    } else {
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
    }
    expect(sitemap).toContain(`<loc>${urlFor(file)}</loc>`);
    if (COPY_PAGES.includes(file) && file !== 'index.html') expect(llms).toContain(urlFor(file));
  });

  it('lists nothing in the sitemap that does not exist', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    for (const loc of locs) {
      const file = loc === `${ORIGIN}/` ? 'index.html' : loc.replace(`${ORIGIN}/`, '');
      expect(existsSync(join(LANDING, file)), loc).toBe(true);
    }
  });

  it.each(ALL_PAGES)('%s links only to pages and anchors that exist', (file) => {
    const html = read(file);
    for (const m of html.matchAll(/href="(?![a-z]+:)([^"#?]*\.html)?(#[^"]+)?"/g)) {
      const target = m[1] || file;
      const anchor = m[2]?.slice(1);
      if (!m[1] && !anchor) continue;
      expect(existsSync(join(LANDING, target)), `${file} -> ${target}`).toBe(true);
      if (anchor) expect(read(target), `${file} -> ${target}#${anchor}`).toContain(`id="${anchor}"`);
    }
  });
});

describe('early-access form contract', () => {
  const html = read('index.html');

  it('posts to a relative path so www, previews and local copies all work', () => {
    // An absolute URL is cross-origin from www.kadensio.com, and the API sends
    // no CORS headers, so the form failed for anyone arriving via www.
    expect(html).toMatch(/var ENDPOINT = '\/api\/waitlist';/);
    expect(html).not.toMatch(/ENDPOINT\s*=\s*['"]https?:/);
  });

  it('checks the email format in the browser as well as for emptiness', () => {
    expect(html).toContain('That does not look like an email address');
  });
});

