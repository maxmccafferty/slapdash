/**
 * Generates the app's design tokens from `docs/design/tokens.json`, so the app and the
 * design export can never drift (ADR-0003, docs/design/HANDOFF.md "Tokens").
 *
 *   pnpm --filter @slapdash/web tokens
 *
 * Writes `src/styles/tokens.css` (CSS custom properties) and `src/styles/tokens.ts`
 * (values CSS variables can't carry, such as the phone breakpoint and the 3D scene
 * colours). Both are committed; `test/tokens.test.ts` fails if they differ from what this
 * script would write.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_JSON_PATH = resolve(here, '../../../docs/design/tokens.json');
export const TOKENS_CSS_PATH = resolve(here, '../src/styles/tokens.css');
export const TOKENS_TS_PATH = resolve(here, '../src/styles/tokens.ts');

const px = z.string().regex(/^\d+(\.\d+)?px$/, 'should be a px value like "14px"');
const ms = z.string().regex(/^\d+ms$/, 'should be a duration like "200ms"');
const tokenName = z.string().regex(/^[a-z][a-z0-9-]*$/, 'should be kebab-case');

const zTokens = z.object({
  color: z.object({
    themes: z.array(z.object({ id: z.string() })).min(1),
    tokens: z.array(
      z.object({
        name: tokenName,
        value: z.record(z.string(), z.string().regex(/^#[0-9A-Fa-f]{6}$/)),
        usage: z.string(),
      }),
    ),
  }),
  type: z.object({
    families: z.record(z.string(), z.string()),
    groups: z.array(
      z.object({
        name: z.string(),
        family: z.string(),
        styles: z.array(
          z.object({
            name: tokenName,
            fontSize: px,
            lineHeight: px,
            fontWeight: z.number().int(),
            usage: z.string(),
          }),
        ),
      }),
    ),
  }),
  spacing: z.object({ tokens: z.array(z.object({ name: tokenName, value: px, usage: z.string() })) }),
  radius: z.object({ tokens: z.array(z.object({ name: tokenName, value: px, usage: z.string() })) }),
  shadow: z.object({ tokens: z.array(z.object({ name: tokenName, value: z.string(), usage: z.string() })) }),
  size: z.object({ tokens: z.array(z.object({ name: tokenName, value: px, usage: z.string() })) }),
  motion: z.object({
    tokens: z.array(z.object({ name: tokenName, duration: ms, easing: z.string(), usage: z.string() })),
  }),
});
export type TokensJson = z.infer<typeof zTokens>;

export function parseTokens(raw: unknown): TokensJson {
  const result = zTokens.safeParse(raw);
  if (!result.success) {
    throw new Error(`docs/design/tokens.json is not in the expected shape:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** One emitted custom property: its name (without `--`) and value. */
export interface CssToken {
  name: string;
  value: string;
}

/** Every custom property the generator emits, in output order. */
export function cssTokens(tokens: TokensJson): CssToken[] {
  const theme = tokens.color.themes[0]!.id;
  const out: CssToken[] = [];
  for (const c of tokens.color.tokens) {
    const value = c.value[theme];
    if (value === undefined) throw new Error(`colour "${c.name}" has no value for theme "${theme}"`);
    out.push({ name: `color-${c.name}`, value: value.toLowerCase() });
  }
  for (const [family, stack] of Object.entries(tokens.type.families)) {
    out.push({ name: `font-${family}`, value: stack });
  }
  for (const group of tokens.type.groups) {
    for (const s of group.styles) {
      out.push({ name: `type-${s.name}-size`, value: s.fontSize });
      out.push({ name: `type-${s.name}-line`, value: s.lineHeight });
      out.push({ name: `type-${s.name}-weight`, value: String(s.fontWeight) });
    }
  }
  for (const group of [tokens.spacing, tokens.radius, tokens.shadow, tokens.size]) {
    for (const t of group.tokens) out.push({ name: t.name, value: t.value });
  }
  for (const m of tokens.motion.tokens) {
    out.push({ name: `${m.name}-duration`, value: m.duration });
    out.push({ name: `${m.name}-easing`, value: m.easing });
  }
  return out;
}

const BANNER = [
  '/*',
  ' * GENERATED from docs/design/tokens.json. Do not edit.',
  ' * Run `pnpm --filter @slapdash/web tokens` after changing the design tokens.',
  ' */',
];

export function generateCss(tokens: TokensJson): string {
  const lines = [...BANNER, ':root {'];
  for (const t of cssTokens(tokens)) lines.push(`  --${t.name}: ${t.value};`);
  lines.push('}');
  return lines.join('\n') + '\n';
}

function pxNumber(value: string): number {
  return Number(value.replace(/px$/, ''));
}

/** The colours the 3D scene uses, as `SCENE_COLORS` keys (camelCase) → token names. */
export const SCENE_COLOR_TOKENS = {
  paper: 'paper',
  floor: 'floor',
  dot: 'dot',
  ink: 'ink',
  keyDark: 'key-dark',
  muted: 'muted',
  signal: 'signal',
  hairline: 'hairline',
  concrete: 'concrete',
  stress1: 'stress-1',
  stress2: 'stress-2',
  stress3: 'stress-3',
  stress4: 'stress-4',
  stress5: 'stress-5',
} as const;

export function generateTs(tokens: TokensJson): string {
  const theme = tokens.color.themes[0]!.id;
  const sceneColors = Object.entries(SCENE_COLOR_TOKENS).map(([key, name]) => {
    const value = tokens.color.tokens.find((c) => c.name === name)?.value[theme];
    if (value === undefined) throw new Error(`tokens.json has no colour "${name}" for theme "${theme}"`);
    return `  ${key}: '${value.toLowerCase()}',`;
  });
  const size = (name: string): number => {
    const t = tokens.size.tokens.find((s) => s.name === name);
    if (!t) throw new Error(`tokens.json has no size token "${name}"`);
    return pxNumber(t.value);
  };
  const names = cssTokens(tokens).map((t) => `  '${t.name}',`);
  return [
    ...BANNER,
    '',
    '/** Below this width the app uses the phone layout. CSS variables cannot be used in @media. */',
    `export const PHONE_BREAKPOINT_PX = ${size('breakpoint-phone')};`,
    '',
    '/** Minimum touch target, in px. */',
    `export const TOUCH_TARGET_PX = ${size('size-touch')};`,
    '',
    '/** Scene colours (hex) for the 3D renderer, which cannot read CSS variables. */',
    'export const SCENE_COLORS = {',
    ...sceneColors,
    '} as const;',
    '',
    '/** Every custom property in tokens.css, without the leading `--`. */',
    'export const TOKEN_NAMES = [',
    ...names,
    '] as const;',
    '',
    'export type TokenName = (typeof TOKEN_NAMES)[number];',
  ].join('\n') + '\n';
}

export function readTokens(path: string = TOKENS_JSON_PATH): TokensJson {
  return parseTokens(JSON.parse(readFileSync(path, 'utf8')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tokens = readTokens();
  writeFileSync(TOKENS_CSS_PATH, generateCss(tokens));
  writeFileSync(TOKENS_TS_PATH, generateTs(tokens));
  console.log('Wrote src/styles/tokens.css and src/styles/tokens.ts from docs/design/tokens.json');
}
