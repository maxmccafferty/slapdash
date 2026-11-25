import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser never sees the Anthropic API key (ADR-0001 §2): app code may not import the
 * server-only keyhole or the Anthropic SDK (type-only imports are erased and allowed), and
 * may not read the key or `process.env`. `pnpm check:secrets` checks the built bundle too.
 */
const SRC = join(import.meta.dirname, '../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|js|jsx|mts)$/.test(path) ? [path] : [];
  });
}

const sources = files(SRC);

/** `import … from 'x'`, `export … from 'x'`, `import('x')` and `import 'x'`, skipping `import type`/`export type`. */
function valueImports(text: string): string[] {
  const specs: string[] = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
    if (!m[2]) specs.push(m[3]!);
  }
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1]!);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

const SERVER_ONLY = /^(@slapdash\/keyhole|@anthropic-ai\/sdk)(\/|$)/;
/** supabase-js only through the storage adapter (`@slapdash/storage/supabase`), loaded lazily. */
const SUPABASE_SDK = /^@supabase\//;
/** The Supabase secret keys are for the add-user script and tests only, never the app. */
const SECRET_KEY_NAMES = /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role/;

describe('no server code in the browser app', () => {
  it('finds the sources', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('the import scanner sees value imports and skips type-only ones', () => {
    const sample = [
      "import { createKeyhole } from '@slapdash/keyhole';",
      "import type { BetaMessageParam } from '@anthropic-ai/sdk/resources';",
      "export { x } from '@anthropic-ai/sdk';",
      "const m = await import('@slapdash/keyhole/node');",
    ].join('\n');
    expect(valueImports(sample).filter((s) => SERVER_ONLY.test(s))).toEqual(['@slapdash/keyhole', '@anthropic-ai/sdk', '@slapdash/keyhole/node']);
  });

  it('the Supabase adapter is only ever loaded lazily', () => {
    const eager = sources.filter((path) => /^\s*import\s+(?!type\b)[^'";]*?from\s*['"]@slapdash\/storage\/supabase['"]/m.test(readFileSync(path, 'utf8')));
    expect(eager.map((p) => relative(SRC, p))).toEqual([]);
  });

  for (const path of sources) {
    const name = relative(SRC, path);
    it(name, () => {
      const text = readFileSync(path, 'utf8');
      expect(valueImports(text).filter((s) => SERVER_ONLY.test(s))).toEqual([]);
      expect(valueImports(text).filter((s) => SUPABASE_SDK.test(s))).toEqual([]);
      expect(text).not.toMatch(SECRET_KEY_NAMES);
      expect(text).not.toMatch(/ANTHROPIC_API_KEY/);
      expect(text).not.toMatch(/\bprocess\.env\b/);
    });
  }
});
