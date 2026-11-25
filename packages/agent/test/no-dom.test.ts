import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The agent runs in the browser and in Node (evals): no DOM, no Node APIs, and only types
 * from the Anthropic SDK (the key never reaches the browser).
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const FORBIDDEN_IMPORTS = /from\s+['"](react|react-dom|three|zustand|@slapdash\/keyhole|@slapdash\/storage)['"]/;
const FORBIDDEN_GLOBALS = /\b(window\.|document\.|localStorage|sessionStorage|indexedDB|navigator\.)/;
const NODE_ONLY = /from\s+['"](node:[^'"]+|fs|path|os|child_process)['"]|\bprocess\.|\bBuffer\./;
/** A value import of the Anthropic SDK (`import type` is erased and allowed). */
const SDK_RUNTIME = /^\s*(import|export)\s+(?!type\b)[^'";]*from\s+['"]@anthropic-ai\/sdk/m;

describe('agent has no DOM, Node or SDK runtime dependencies', () => {
  const files = walk(SRC);

  it('found the source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('the SDK check catches value imports only', () => {
    expect("import Anthropic from '@anthropic-ai/sdk';").toMatch(SDK_RUNTIME);
    expect("import type { BetaMessageParam } from '@anthropic-ai/sdk/resources';").not.toMatch(SDK_RUNTIME);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(FORBIDDEN_IMPORTS);
    expect(text).not.toMatch(FORBIDDEN_GLOBALS);
    expect(text).not.toMatch(NODE_ONLY);
    expect(text).not.toMatch(SDK_RUNTIME);
  });
});
