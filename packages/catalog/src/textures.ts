/**
 * The texture manifest (`textures/manifest.json`): CC0 texture sets from Poly Haven and
 * ambientCG (ADR-0001 §6), encoded to KTX2 by `scripts/build-textures.ts` and committed.
 * Several materials share one set; the material's swatch colour tints it.
 */
import { z } from 'zod';

export const TEXTURE_MAPS = ['color', 'normal', 'roughness', 'ao', 'metalness'] as const;
export const zTextureMap = z.enum(TEXTURE_MAPS);
export type TextureMap = z.infer<typeof zTextureMap>;

export const zTextureSet = z.strictObject({
  /** Referenced by a material's `textureSet`, and the folder name under `textures/`. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  source: z.enum(['polyhaven', 'ambientcg']),
  /** The asset id on the source site, e.g. "oriented_strand_board" or "Wood048". */
  assetId: z.string().min(1),
  url: z.url(),
  author: z.string().min(1),
  license: z.literal('CC0-1.0'),
  fetchedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Real-world size one tile of the texture covers, in mm (ADR-0001 §6 "real-world scale"). */
  tileSize_mm: z.strictObject({ u: z.number().positive(), v: z.number().positive() }),
  /** Where the tile size came from, when the asset page doesn't state it. */
  tileSizeNote: z.string().min(1).optional(),
  maps: z.array(zTextureMap).min(1),
});
export type TextureSet = z.infer<typeof zTextureSet>;

export const zTextureManifest = z.strictObject({
  sets: z.array(zTextureSet),
});
export type TextureManifest = z.infer<typeof zTextureManifest>;

/** Path of one map inside the package, e.g. "textures/osb/color.ktx2". */
export function texturePath(setId: string, map: TextureMap): string {
  return `textures/${setId}/${map}.ktx2`;
}
