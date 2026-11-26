import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './pwa-manifest.ts';

const require = createRequire(import.meta.url);
// `three` doesn't export package.json; resolve a file it does export and walk to the folder.
const BASIS_DIR = join(dirname(require.resolve('three/examples/jsm/loaders/KTX2Loader.js')), '../libs/basis');
const BASIS_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'];
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The `paper` colour token: the manifest's theme and splash background. */
function paperColour(): string {
  const tokens = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/design/tokens.json'), 'utf8')) as {
    color: { tokens: { name: string; value: { light: string } }[] };
  };
  return tokens.color.tokens.find((t) => t.name === 'paper')?.value.light.toLowerCase() ?? '#ffffff';
}

/**
 * The only build-time env that reaches the browser besides Vite's own `VITE_*` handling:
 * the Supabase project URL and publishable key, also accepted under the Vercel Supabase
 * integration's names. An explicit allow-list of two values — never the secret or
 * service-role key, which only the add-user script and the integration tests read.
 */
function supabaseBrowserEnv(mode: string): Record<string, string> {
  const env = loadEnv(mode, REPO_ROOT, '');
  const pick = (...names: string[]) => names.map((n) => env[n]?.trim()).find((v) => v) ?? '';
  const url = pick('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const key = pick(
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
  );
  return {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(key),
  };
}

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

export default defineConfig(({ mode }) => {
  const browserEnv = supabaseBrowserEnv(mode);
  const hosted = browserEnv['import.meta.env.VITE_SUPABASE_URL'] !== '""';
  return {
    plugins: [
      react(),
      basisTranscoder(),
      claudeKeyhole(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registered from main.tsx, so e2e runs (?e2e) aren't served stale bundles.
        injectRegister: null,
        includeAssets: ['icons/*'],
        manifest: pwaManifest(paperColour()),
        workbox: {
          // The app shell, the lazy 3D chunk, fonts and the basis transcoder.
          globPatterns: ['**/*.{js,css,html,svg,woff2,wasm}'],
          // A local-only build never loads the Supabase chunk, so it isn't downloaded for offline either.
          ...(hosted ? {} : { globIgnores: ['**/supabase-*.js'] }),
          // The three.js chunk is several MB.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          // Textures are fetched as the 3D view needs them; keep them once seen. Nothing for
          // /api/ or the Supabase origin: those always go to the network.
          runtimeCaching: [
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /\.ktx2$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'slapdash-assets',
                expiration: { maxEntries: 60, maxAgeSeconds: 365 * 24 * 60 * 60 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    define: browserEnv,
    // Catalog textures are KTX2; they are imported as URLs (src/renderer/textures.ts).
    assetsInclude: ['**/*.ktx2'],
    build: {
      // The 3D view is a lazy chunk; three.js alone is over the default warning size.
      chunkSizeWarningLimit: 1500,
    },
    // The solver worker (src/analysis/solver-worker.ts) is an ES module so it can load
    // Rapier as a lazy chunk only when a stability sim is asked for.
    worker: { format: 'es' },
  };
});
