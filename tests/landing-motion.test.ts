import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'landing', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Remove every `@media (...) { ... }` block whose query matches, tracking braces. */
function withoutBlocks(source: string, query: RegExp): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf('@media', i);
    if (at === -1) {
      out += source.slice(i);
      break;
    }
    const open = source.indexOf('{', at);
    const header = source.slice(at, open);
    if (!query.test(header)) {
      out += source.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    out += source.slice(i, at);
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    i = j;
  }
  return out;
}

describe('landing motion rules', () => {
  it('never transitions "all"', () => {
    expect(css).not.toMatch(/transition(-property)?\s*:\s*all\b/);
  });

  it('never uses ease-in on the interface', () => {
    expect(css).not.toMatch(/\bease-in\b(?!-)/);
  });

  it('never enters from scale(0)', () => {
    expect(css).not.toMatch(/scale\(\s*0\s*[,)]/);
  });

  it('only animates hover inside the hover-capable pointer query', () => {
    const outside = withoutBlocks(css, /hover:\s*hover/);
    expect(outside).not.toMatch(/:hover/);
  });

  it('gives movement a reduced-motion alternative', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduce = css.slice(css.indexOf('(prefers-reduced-motion: reduce)'));
    expect(reduce).toMatch(/navigation:\s*none/);
  });

  it('keeps UI transitions under 300ms unless they ride the spring', () => {
    const slow: string[] = [];
    for (const line of css.split('\n')) {
      if (!/transition\s*:/.test(line) || line.includes('var(--spring)')) continue;
      for (const m of line.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
        if (ms > 300) slow.push(line.trim());
      }
    }
    expect(slow).toEqual([]);
  });

  it('presses scale down by 3% and no more', () => {
    expect(css).toMatch(/\.btn:active\s*\{\s*transform:\s*scale\(0\.97\)/);
  });
});
