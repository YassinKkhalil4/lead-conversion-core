import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('environment contract', () => {
  it('keeps .env.example aligned with validated runtime variables and generator replacements', () => {
    const example = readFileSync('.env.example', 'utf8');
    const envSource = readFileSync('src/config/env.ts', 'utf8');
    const generator = readFileSync('scripts/generate-env.sh', 'utf8');

    for (const [, name] of envSource.matchAll(/^\s{2}([A-Z0-9_]+):/gm)) {
      expect(example, `${name} missing from .env.example`).toContain(`${name}=`);
    }

    for (const placeholder of [
      'EDGE_POSTGRES_PASSWORD=replace-with-secret',
      'DATABASE_URL=postgresql://lead_os_edge_app:replace-with-secret@127.0.0.1:5432/lead_os_edge',
      'EDGE_SHARED_SECRET=replace-with-at-least-16-chars',
      'EDGE_INTERNAL_SECRET=replace-with-at-least-16-chars',
    ]) {
      expect(example).toContain(placeholder);
      expect(generator).toContain(placeholder);
    }
  });
});
