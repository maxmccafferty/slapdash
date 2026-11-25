/**
 * The PWA manifest (vite.config.ts → vite-plugin-pwa): installs to the iPad and iPhone home
 * screen and opens full-screen. The icons are made by `pnpm --filter @slapdash/web icons`.
 */
import type { ManifestOptions } from 'vite-plugin-pwa';

/** `paper` is the `paper` colour token: the theme colour and the splash background. */
export function pwaManifest(paper: string): Partial<ManifestOptions> {
  return {
    name: 'Slapdash',
    short_name: 'Slapdash',
    description: 'Design small wood-frame buildings by talking to Claude: a 3D model, drawings, materials and build steps.',
    start_url: '/',
    scope: '/',
    // iPadOS opens standalone web apps without browser chrome; `fullscreen` is ignored there.
    display: 'standalone',
    orientation: 'any',
    background_color: paper,
    theme_color: paper,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
