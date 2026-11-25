import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
// `three` doesn't export package.json; resolve a file it does export and walk to the folder.
const BASIS_DIR = join(dirname(require.resolve('three/examples/jsm/loaders/KTX2Loader.js')), '../libs/basis');
const BASIS_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'];
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Serves three's basis transcoder at `/basis/` (dev) and copies it into `dist/basis/`
 * (build). KTX2Loader loads it by fixed file name, so it can't go through the hashed
 * asset pipeline.
 */
function basisTranscoder(): Plugin {
  return {
    name: 'slapdash:basis-transcoder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace(/^.*\/basis\//, '');
        if (!req.url?.includes('/basis/') || !name || !BASIS_FILES.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(BASIS_DIR, name)));
      });
    },
    generateBundle() {
      for (const name of BASIS_FILES) {
        this.emitFile({ type: 'asset', fileName: `basis/${name}`, source: readFileSync(join(BASIS_DIR, name)) });
      }
    },
  };
}

/**
 * Serves the Claude keyhole at `/api/claude` in `vite dev`, the same handler Vercel runs from
 * `api/claude.ts`. Dev only: `vite build` never loads it.
 *
 * The server environment comes from the repo-root `.env` through `loadEnv(…, '')` and goes
 * only to the keyhole, never into `define`. Only `VITE_*` variables reach the browser, so
 * `ANTHROPIC_API_KEY` must never be given a `VITE_` prefix.
 */
function claudeKeyhole(): Plugin {
  return {
    name: 'slapdash:keyhole',
    apply: 'serve',
    async configureServer(server) {
      const env = loadEnv(server.config.mode, REPO_ROOT, '');
      // ssrLoadModule compiles the workspace TypeScript; the handler is built on the first request.
      const { toNodeMiddleware } = (await server.ssrLoadModule('@slapdash/keyhole/node')) as typeof import('@slapdash/keyhole/node');
      server.middlewares.use(
        '/api/claude',
        toNodeMiddleware({
          load: async () => {
            const keyhole = (await server.ssrLoadModule('@slapdash/keyhole')) as typeof import('@slapdash/keyhole');
            return keyhole.createKeyholeFromEnv({ ...env, SLAPDASH_USAGE_FILE: env.SLAPDASH_USAGE_FILE || join(REPO_ROOT, '.data/usage.json') });
          },
        }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), basisTranscoder(), claudeKeyhole()],
  // Catalog textures are KTX2; they are imported as URLs (src/renderer/textures.ts).
  assetsInclude: ['**/*.ktx2'],
  build: {
    // The 3D view is a lazy chunk; three.js alone is over the default warning size.
    chunkSizeWarningLimit: 1500,
  },
});
