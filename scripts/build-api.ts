/**
 * Bundles the Claude keyhole into `packages/keyhole/dist/vercel.js`: one ESM file with every
 * dependency inlined (the workspace TypeScript, zod and the Anthropic SDK). The tracked
 * `api/claude.js` re-exports it, so Vercel finds the function before the build and ships the
 * bundle after it.
 *
 *   pnpm build:api
 *
 * Why a bundle: Vercel's Node builder renames workspace `.ts` files to `.js` but leaves `.ts`
 * import specifiers and package `exports` pointing at `.ts`, so the raw sources fail at runtime.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const API_BUNDLE = 'packages/keyhole/dist/vercel.js';

export async function buildApi(outfile: string = API_BUNDLE): Promise<void> {
  await build({
    absWorkingDir: root,
    entryPoints: ['packages/keyhole/src/vercel-entry.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
    // Some dependencies are CommonJS and call `require`; give the ESM bundle one.
    banner: { js: "import { createRequire as __slapdashRequire } from 'node:module'; const require = __slapdashRequire(import.meta.url);" },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildApi();
  console.log(`build:api ok — wrote ${API_BUNDLE}`);
}
