import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const FORBIDDEN_IMPORTS = /from\s+['"](react|react-dom|three|zustand|@react-three\/[^'"]+)['"]/;
const FORBIDDEN_GLOBALS = /\b(window\.|document\.|localStorage|sessionStorage|indexedDB|navigator\.)/;
const NODE_ONLY = /from\s+['"](node:[^'"]+|fs|path|os|child_process)['"]|\bprocess\./;

describe('core has no DOM or framework dependencies', () => {
  it('runs in an environment without window or document', () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined();
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
  });

  const files = walk(SRC);
  it('found the source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))('%s imports no DOM, framework or Node-only APIs', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(FORBIDDEN_IMPORTS);
    expect(text).not.toMatch(FORBIDDEN_GLOBALS);
    expect(text).not.toMatch(NODE_ONLY);
  });
});
