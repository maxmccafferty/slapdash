import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEXTURE_SETS, texturePath, zTextureManifest } from '../src/index.ts';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXTURES = join(PKG, 'textures');
/** The 12-byte KTX2 file identifier: «KTX 20»\r\n\x1A\n. */
const KTX2_ID = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('textures', () => {
  it('the manifest validates', () => {
    const raw = JSON.parse(readFileSync(join(TEXTURES, 'manifest.json'), 'utf8'));
    expect(zTextureManifest.safeParse(raw).success).toBe(true);
    expect(new Set(TEXTURE_SETS.map((s) => s.id)).size).toBe(TEXTURE_SETS.length);
  });

  it('every set is CC0 from Poly Haven or ambientCG', () => {
    for (const s of TEXTURE_SETS) {
      expect(s.license, s.id).toBe('CC0-1.0');
      expect(['polyhaven', 'ambientcg'], s.id).toContain(s.source);
      expect(s.url, s.id).toMatch(s.source === 'polyhaven' ? /^https:\/\/polyhaven\.com\/a\// : /^https:\/\/ambientcg\.com\//);
      expect(s.maps, s.id).toContain('color');
    }
  });

  it('every listed map is a KTX2 file', () => {
    for (const s of TEXTURE_SETS) {
      for (const map of s.maps) {
        const head = readFileSync(join(PKG, texturePath(s.id, map))).subarray(0, 12);
        expect(head.equals(KTX2_ID), `${s.id}/${map}`).toBe(true);
      }
    }
  });

  it('there are no stray files or folders', () => {
    const expected = new Set(['manifest.json', 'ATTRIBUTION.md', ...TEXTURE_SETS.map((s) => s.id)]);
    expect(readdirSync(TEXTURES).filter((n) => !expected.has(n) && n !== '.DS_Store')).toEqual([]);
    for (const s of TEXTURE_SETS) {
      const files = readdirSync(join(TEXTURES, s.id)).filter((n) => n !== '.DS_Store');
      expect(files.sort(), s.id).toEqual(s.maps.map((m) => `${m}.ktx2`).sort());
    }
  });

  it('stays inside the size budget (1.5 MB a file, 35 MB in all)', () => {
    let total = 0;
    for (const s of TEXTURE_SETS) {
      for (const map of s.maps) {
        const size = statSync(join(PKG, texturePath(s.id, map))).size;
        expect(size, `${s.id}/${map}`).toBeLessThanOrEqual(1.5 * 1024 * 1024);
        total += size;
      }
    }
    expect(total).toBeLessThanOrEqual(35 * 1024 * 1024);
  });

  it('ATTRIBUTION.md credits every set', () => {
    const text = readFileSync(join(TEXTURES, 'ATTRIBUTION.md'), 'utf8');
    for (const s of TEXTURE_SETS) {
      expect(text, s.id).toContain(`\`${s.id}\``);
      expect(text, s.id).toContain(s.url);
      expect(text, s.id).toContain(s.author);
    }
    expect(text).toContain('CC0');
  });
});
