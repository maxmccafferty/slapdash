/**
 * Catalog textures (KTX2, CC0) for the renderer. The catalog's `.ktx2` files are bundled as
 * URLs; the basis transcoder is served from `/basis/` (see `vite.config.ts`). Each map loads
 * once and is shared by every material and both scenes (the user's view and snapshots).
 */
import { RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture, type WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { TEXTURE_SETS, texturePath, type TextureMap, type TextureSet } from '@slapdash/catalog';

const urls = import.meta.glob('../../../../packages/catalog/textures/**/*.ktx2', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `textures/osb/color.ktx2` → bundled URL. */
const URL_BY_PATH = new Map(
  Object.entries(urls).map(([file, url]) => [file.slice(file.indexOf('textures/')), url] as const),
);

export function textureUrl(setId: string, map: TextureMap): string | undefined {
  return URL_BY_PATH.get(texturePath(setId, map));
}

const SETS = new Map(TEXTURE_SETS.map((s) => [s.id, s]));

export function textureSet(id: string | undefined): TextureSet | undefined {
  return id ? SETS.get(id) : undefined;
}

let enabled = true;
/** Tests (no WebGL, no workers) turn texture loading off. */
export function setTextureLoadingEnabled(on: boolean): void {
  enabled = on;
}

let loader: KTX2Loader | null = null;
let loaderRenderer: WebGLRenderer | null = null;
const cache = new Map<string, Promise<Texture | null>>();
const pending = new Set<Promise<unknown>>();
let anisotropy = 4;

function getLoader(gl: WebGLRenderer): KTX2Loader {
  if (!loader || loaderRenderer !== gl) {
    loader?.dispose();
    loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).setWorkerLimit(2);
    loader.detectSupport(gl);
    loaderRenderer = gl;
    cache.clear();
  }
  return loader;
}

/** Cap anisotropy for maps loaded from now on, and update the ones already loaded. */
export async function setTextureAnisotropy(value: number): Promise<void> {
  anisotropy = value;
  for (const p of cache.values()) {
    const tex = await p;
    if (tex && tex.anisotropy !== value) {
      tex.anisotropy = value;
      tex.needsUpdate = true;
    }
  }
}

/**
 * Load one map of a set (cached). Resolves to null when textures are off, the map doesn't
 * exist or it fails to load: the material then uses its swatch colour alone.
 */
export function loadTexture(gl: WebGLRenderer, setId: string, map: TextureMap): Promise<Texture | null> {
  const url = textureUrl(setId, map);
  if (!enabled || !url || typeof Worker === 'undefined') return Promise.resolve(null);
  const key = `${setId}/${map}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = getLoader(gl)
    .loadAsync(url)
    .then((tex): Texture => {
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
      tex.colorSpace = map === 'color' ? SRGBColorSpace : NoColorSpace;
      tex.anisotropy = Math.min(anisotropy, gl.capabilities.getMaxAnisotropy());
      tex.needsUpdate = true;
      return tex;
    })
    .catch((err: unknown) => {
      console.warn(`Couldn't load texture ${key}:`, err);
      return null;
    })
    .finally(() => pending.delete(promise));
  pending.add(promise);
  cache.set(key, promise);
  return promise;
}

/** Resolves when every texture load started so far has finished (used before a snapshot). */
export async function texturesSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
