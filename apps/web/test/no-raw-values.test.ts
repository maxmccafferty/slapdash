import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Chrome takes its colours, type, sizes and motion only from the generated tokens
 * (`var(--…)`), so the app cannot drift from docs/design/tokens.json.
 */
const SRC = join(import.meta.dirname, '../src');

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

/** CSS without comments, and without the unicode-range descriptors in @font-face. */
function cssBody(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/unicode-range:[^;]*;/g, '')
    .replace(/url\([^)]*\)/g, 'url()');
}

const NAMED_COLOURS = /\b(white|black|red|green|blue|orange|grey|gray|silver|yellow|purple|pink|brown|navy|teal)\b/;
/** Hairlines, the visually-hidden utility and zero. */
const PX_ALLOWED = new Set(['0px', '1px', '-1px']);

const cssFiles = files(SRC, '.css').filter((p) => !p.endsWith('tokens.css'));

describe('no raw values in CSS', () => {
  it('finds the stylesheets', () => {
    expect(cssFiles.length).toBeGreaterThan(5);
  });

  for (const path of cssFiles) {
    const name = relative(SRC, path);
    it(name, () => {
      const body = cssBody(path);
      const problems: string[] = [];
      for (const [i, line] of body.split('\n').entries()) {
        const where = `${name}:${i + 1}: ${line.trim()}`;
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) problems.push(`hex colour — ${where}`);
        if (/\b(rgba?|hsla?)\(/.test(line)) problems.push(`colour function — ${where}`);
        const colourValue = /(color|background|border|outline|fill|stroke|shadow)[a-z-]*:\s*(.*)$/.exec(line)?.[2];
        if (colourValue && NAMED_COLOURS.test(colourValue)) problems.push(`named colour — ${where}`);
        if (/font-size:/.test(line) && !/font-size:\s*(var\(|inherit)/.test(line)) problems.push(`raw font-size — ${where}`);
        if (/\d(ms|s)\b/.test(line) && !/0\.01ms/.test(line)) problems.push(`raw duration — ${where}`);
        for (const px of line.match(/-?\d*\.?\d+px/g) ?? []) {
          if (!PX_ALLOWED.has(px)) problems.push(`raw ${px} — ${where}`);
        }
        if (/(^|[^-])color:\s*var\(--color-signal\)/.test(line)) problems.push(`orange text — ${where}`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe('no raw colours in components', () => {
  const tsxFiles = files(SRC, '.tsx');
  for (const path of tsxFiles) {
    const name = relative(SRC, path);
    it(name, () => {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/style=\{\{[^}]*(color|background)[^}]*['"`]#/i);
      expect(source).not.toMatch(/style=\{\{[^}]*['"`](rgb|hsl)a?\(/i);
    });
  }
});
