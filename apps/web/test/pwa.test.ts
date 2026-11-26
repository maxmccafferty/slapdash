/** The installable app (PWA): the manifest, the icons and the home-screen tags in index.html. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pwaManifest } from '../pwa-manifest.ts';

const APP = join(import.meta.dirname, '..');
const PUBLIC = join(APP, 'public');

const tokens = JSON.parse(readFileSync(join(APP, '../../docs/design/tokens.json'), 'utf8')) as {
  color: { tokens: { name: string; value: { light: string } }[] };
};
const PAPER = tokens.color.tokens.find((t) => t.name === 'paper')!.value.light.toLowerCase();
const MANIFEST = pwaManifest(PAPER);

/** Width and height from a PNG's IHDR chunk, and whether it has an alpha channel. */
function pngInfo(path: string): { width: number; height: number; alpha: boolean } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  const colourType = bytes[25]!;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 };
}

describe('the web app manifest', () => {
  it('installs as "Slapdash" and opens standalone (full-screen on iPad)', () => {
    expect(MANIFEST).toMatchObject({
      name: 'Slapdash',
      short_name: 'Slapdash',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
    });
  });

  it('lists 192 and 512 icons and a maskable one, and each file exists at its size', () => {
    const icons = MANIFEST.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of icons) {
      const path = join(PUBLIC, icon.src);
      expect(existsSync(path), icon.src).toBe(true);
      const [w, h] = icon.sizes!.split('x').map(Number);
      expect(pngInfo(path)).toMatchObject({ width: w, height: h });
    }
  });

  it('the maskable and Apple icons are opaque (full-bleed)', () => {
    expect(pngInfo(join(PUBLIC, 'icons/icon-maskable-512.png')).alpha).toBe(false);
    expect(pngInfo(join(PUBLIC, 'icons/apple-touch-icon.png'))).toEqual({ width: 180, height: 180, alpha: false });
  });
});

describe('index.html', () => {
  const html = readFileSync(join(APP, 'index.html'), 'utf8');
  const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];

  it('has the home-screen tags for iOS and Android', () => {
    expect(meta('theme-color')).toBe('#ffffff');
    expect(meta('apple-mobile-web-app-capable')).toBe('yes');
    expect(meta('mobile-web-app-capable')).toBe('yes');
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent');
    expect(meta('apple-mobile-web-app-title')).toBe('Slapdash');
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
  });

  it('links the Apple touch icon and the favicon, and both exist', () => {
    const touch = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1];
    const favicon = /<link rel="icon" href="([^"]+)"/.exec(html)?.[1];
    expect(touch).toBe('/icons/apple-touch-icon.png');
    expect(favicon).toBe('/icons/favicon.svg');
    expect(existsSync(join(PUBLIC, touch!))).toBe(true);
    expect(existsSync(join(PUBLIC, favicon!))).toBe(true);
  });
});
