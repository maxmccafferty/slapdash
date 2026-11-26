/**
 * Only code under src/adapters/<name>/ may import a backend SDK (ADR-0001 §10), and the
 * rest of the package stays free of browser globals so it runs in Node and workers.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const BACKEND_SDK_IMPORT =
  /(?:from\s+|import\s*\(\s*|import\s+)['"](dexie|idb|idb-keyval|fake-indexeddb|firebase|pocketbase|@supabase\/[^'"]+|@firebase\/[^'"]+)(?:\/[^'"]*)?['"]/;
const FORBIDDEN_GLOBALS = /\b(window\.|document\.|localStorage|sessionStorage|indexedDB\b|navigator\.)/;

const files = walk(SRC).map((f) => ({ file: f, rel: relative(SRC, f).split(sep).join('/') }));
const isAdapter = (rel: string) => /^adapters\/[^/]+\//.test(rel);

describe('storage boundaries', () => {
  it('found the source files and at least one adapter', () => {
    expect(files.length).toBeGreaterThan(8);
    expect(files.some((f) => isAdapter(f.rel))).toBe(true);
  });

  it('the guard pattern catches SDK imports', () => {
    expect("import { Dexie } from 'dexie';").toMatch(BACKEND_SDK_IMPORT);
    expect('import Dexie from "dexie"').toMatch(BACKEND_SDK_IMPORT);
    expect("import 'fake-indexeddb/auto';").toMatch(BACKEND_SDK_IMPORT);
    expect("const m = await import('@supabase/supabase-js');").toMatch(BACKEND_SDK_IMPORT);
    expect("import { openDB } from 'idb';").toMatch(BACKEND_SDK_IMPORT);
    expect("import { z } from 'zod';").not.toMatch(BACKEND_SDK_IMPORT);
  });

  const outside = files.filter((f) => !isAdapter(f.rel));
  it.each(outside.map((f) => [f.rel, f.file]))('%s imports no backend SDK and uses no browser globals', (_rel, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(BACKEND_SDK_IMPORT);
    expect(text).not.toMatch(FORBIDDEN_GLOBALS);
  });
});
