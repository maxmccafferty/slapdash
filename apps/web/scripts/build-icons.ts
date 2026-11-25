/**
 * The PWA and home-screen icons, from the logo files in docs/design/logo/:
 *
 *   pnpm --filter @slapdash/web icons
 *
 * Writes public/icons/: icon-192.png and icon-512.png (the app icon as drawn),
 * icon-maskable-512.png (the stud wall at 80% on a full-bleed square, inside Android's safe
 * zone), apple-touch-icon.png (180 px, full-bleed and opaque: iOS rounds the corners
 * itself) and favicon.svg (the mark). The output is committed, so builds don't need sharp.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const OUT = fileURLToPath(new URL('../public/icons', import.meta.url));
const LOGO = join(REPO, 'docs/design/logo');

/** Drop the c2pa provenance block: it is most of the file and browsers don't need it. */
const stripMetadata = (svg: string) => svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '').replace(/\s+xmlns:c2pa="[^"]*"/, '');

const icon = stripMetadata(readFileSync(join(LOGO, 'slapdash-icon.svg'), 'utf8'));
const mark = stripMetadata(readFileSync(join(LOGO, 'slapdash-mark.svg'), 'utf8'));

// The icon is a rounded square (the first rect) with the stud wall on it.
const rects = [...icon.matchAll(/<rect\b[^>]*>(?:<\/rect>)?/g)].map((m) => m[0]);
const background = /fill="(#[0-9A-Fa-f]{3,8})"/.exec(rects[0] ?? '')?.[1];
if (!background || rects.length < 2) throw new Error('slapdash-icon.svg: expected a background rect and the stud wall.');
const glyph = rects.slice(1).join('');

/** The stud wall on a full-bleed square, scaled about the centre. */
function square(scale: number): string {
  const offset = 60 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="${background}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g></svg>`;
}

async function png(svg: string, size: number, name: string, opaque = false): Promise<void> {
  let image = sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 120) }).resize(size, size);
  if (opaque) image = image.flatten({ background }).removeAlpha();
  await image.png({ compressionLevel: 9 }).toFile(join(OUT, name));
  console.log(`  ${name} (${size}×${size})`);
}

mkdirSync(OUT, { recursive: true });
console.log(`Writing ${OUT}`);
await png(icon, 192, 'icon-192.png');
await png(icon, 512, 'icon-512.png');
await png(square(0.8), 512, 'icon-maskable-512.png', true);
await png(square(1), 180, 'apple-touch-icon.png', true);
writeFileSync(join(OUT, 'favicon.svg'), `${mark.trim()}\n`);
console.log('  favicon.svg');
