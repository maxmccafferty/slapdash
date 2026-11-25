/**
 * Part materials. A material is drawn from its catalog entry alone: the swatch (colour,
 * roughness, metalness, opacity) and, when it has one, its CC0 texture set at real-world
 * scale. Nothing else is needed to draw a new material (see CONTRIBUTING "Renderer").
 *
 * Every part is an instance of a unit box, so the standard material is patched
 * (`onBeforeCompile`):
 * - **World-scale box UVs.** Texture coordinates come from the box's local position times
 *   the instance's size (in mm) divided by the set's `tileSize_mm`. u follows local x, the
 *   board length, so wood grain runs along each board.
 * - **Per-board variation.** `aVariation` (per instance) offsets the texture and tints the
 *   colour by up to ±4%, so neighbouring studs don't look stamped.
 * - **The Inside cut** (see `CutFaces.ts`).
 *
 * Blueprint and x-ray are snapshot-only modes (ADR-0003 §J removes them from the UI).
 */
import {
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RED_GREEN_RGTC2_Format,
  RG11_EAC_Format,
  RGBADepthPacking,
  RGFormat,
  ShaderChunk,
  SIGNED_RED_GREEN_RGTC2_Format,
  SIGNED_RG11_EAC_Format,
  type Material as ThreeMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import type { CatalogIndex, Material } from '@slapdash/core';
import { SCENE_COLORS } from '../styles/tokens.ts';
import type { CutUniforms } from './CutFaces.ts';
import type { QualityTier } from './quality.ts';
import { TIER_SETTINGS } from './quality.ts';
import { loadTexture, textureSet } from './textures.ts';
import type { RenderableMode } from './snapshot/types.ts';

const PATCH_VERSION = 'slapdash-part-v1';

const VERTEX_PARS = /* glsl */ `
attribute vec2 aVariation;
attribute float aCuttable;
uniform vec2 uTileSize;
varying float vTint;
varying float vCuttable;
varying float vWorldY;
varying vec2 vBoxUv;
`;

/**
 * After project_vertex: box UVs and the world y. `position` is the unit box (0..1); the
 * instance matrix scales it to the part's size in metres.
 */
const VERTEX_MAIN = /* glsl */ `
  {
    #ifdef USE_INSTANCING
      mat4 im = instanceMatrix;
    #else
      mat4 im = mat4(1.0);
    #endif
    vec3 sizeMm = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz)) * 1000.0;
    vec3 p = position * sizeMm;
    vec3 n = abs(normal);
    vec2 uvMm = n.x > 0.5 ? p.zy : (n.y > 0.5 ? p.xz : p.xy);
    vBoxUv = uvMm / uTileSize + vec2(aVariation.x * 7.31, aVariation.x * 3.17);
    vTint = aVariation.y;
    vCuttable = aCuttable;
    vWorldY = (modelMatrix * im * vec4(position, 1.0)).y;
  }
  #ifdef USE_MAP
    vMapUv = vBoxUv;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = vBoxUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = vBoxUv;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv = vBoxUv;
  #endif
  #ifdef USE_AOMAP
    vAoMapUv = vBoxUv;
  #endif
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uCutActive;
uniform float uCutY;
uniform vec3 uCutColor;
varying float vTint;
varying float vCuttable;
varying float vWorldY;
`;

const FRAGMENT_CUT = /* glsl */ `
  if (uCutActive > 0.5 && vCuttable > 0.5 && vWorldY > uCutY) discard;
`;

const FRAGMENT_TINT = /* glsl */ `
  diffuseColor.rgb *= 1.0 + vTint;
`;

/** The cut faces: with the top cut off, the inside of a box (its back faces) shows. Paint it dark. */
const FRAGMENT_CUT_FACE = /* glsl */ `
  if (uCutActive > 0.5 && !gl_FrontFacing) gl_FragColor = vec4(uCutColor, 1.0);
`;

interface PatchOptions {
  cut: CutUniforms;
  tileSize: [number, number];
  tint: boolean;
  cutFaces: boolean;
}

/**
 * The catalog's maps (packages/catalog/scripts/build-textures.ts) are not laid out the way
 * three's standard material reads them:
 * - roughness and metalness are single-channel (R8), but three reads `.g` and `.b`;
 * - normals are UASTC "normal mode" (X in RGB, Y in alpha). Three handles them when the
 *   loader transcodes to a two-channel format (`USE_PACKED_NORMALMAP`); on an RGBA fallback
 *   `SLAPDASH_NORMAL_RA` reconstructs the normal from red and alpha instead.
 */
const MAP_CHANNEL_FIXES: { chunk: 'roughnessmap_fragment' | 'metalnessmap_fragment' | 'normal_fragment_maps'; from: string; to: string }[] = [
  { chunk: 'roughnessmap_fragment', from: 'roughnessFactor *= texelRoughness.g;', to: 'roughnessFactor *= texelRoughness.r;' },
  { chunk: 'metalnessmap_fragment', from: 'metalnessFactor *= texelMetalness.b;', to: 'metalnessFactor *= texelMetalness.r;' },
  {
    chunk: 'normal_fragment_maps',
    from: 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
    to: `#ifdef SLAPDASH_NORMAL_RA
      vec4 normalTexel = texture2D( normalMap, vNormalMapUv );
      vec3 mapN = vec3( normalTexel.r * 2.0 - 1.0, normalTexel.a * 2.0 - 1.0, 0.0 );
      mapN.z = sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) );
    #else
      vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
    #endif`,
  },
];

/** Formats three already unpacks as two-channel normals (`USE_PACKED_NORMALMAP`). */
const PACKED_RG_FORMATS: ReadonlySet<number> = new Set<number>([
  RGFormat,
  RED_GREEN_RGTC2_Format,
  SIGNED_RED_GREEN_RGTC2_Format,
  RG11_EAC_Format,
  SIGNED_RG11_EAC_Format,
]);

/** A normal map that isn't a packed RG format came through as RGBA: read X from red, Y from alpha. */
export function needsRaNormals(format: number): boolean {
  return !PACKED_RG_FORMATS.has(format);
}

function patch(shader: WebGLProgramParametersWithUniforms, opts: PatchOptions) {
  shader.uniforms.uCutActive = opts.cut.uCutActive;
  shader.uniforms.uCutY = opts.cut.uCutY;
  shader.uniforms.uCutColor = opts.cut.uCutColor;
  shader.uniforms.uTileSize = { value: opts.tileSize };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
  let frag = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_CUT}`);
  if (opts.tint) frag = frag.replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_TINT}`);
  if (opts.cutFaces) frag = frag.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FRAGMENT_CUT_FACE}`);
  // The includes aren't expanded yet: inline the chunk, then fix its channel reads.
  for (const { chunk, from, to } of MAP_CHANNEL_FIXES) {
    frag = frag.replace(`#include <${chunk}>`, ShaderChunk[chunk].replace(from, to));
  }
  shader.fragmentShader = frag;
}

/** Depth shaders have no `normal` attribute in scope; only the cut matters for shadows. */
function patchDepth(shader: WebGLProgramParametersWithUniforms, cut: CutUniforms) {
  shader.uniforms.uCutActive = cut.uCutActive;
  shader.uniforms.uCutY = cut.uCutY;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aCuttable;\nvarying float vCuttable;\nvarying float vWorldY;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vCuttable = aCuttable;
      #ifdef USE_INSTANCING
        vWorldY = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y;
      #else
        vWorldY = (modelMatrix * vec4(position, 1.0)).y;
      #endif`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uCutActive;\nuniform float uCutY;\nvarying float vCuttable;\nvarying float vWorldY;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_CUT}`);
}

export interface PartMaterials {
  material: ThreeMaterial;
  /** For shadows: casts no shadow from the cut-away part of a wall. */
  depthMaterial: MeshDepthMaterial;
  /** Whether instances of this batch are drawn after opaque ones (glass). */
  transparent: boolean;
}

const NEUTRAL = SCENE_COLORS.concrete;
const WHITE = new Color(1, 1, 1);

function baseOpts(cut: CutUniforms, material: Material | undefined, tint: boolean, cutFaces: boolean): PatchOptions {
  const set = textureSet(material?.textureSet);
  return { cut, tint, cutFaces, tileSize: set ? [set.tileSize_mm.u, set.tileSize_mm.v] : [1000, 1000] };
}

function createDepthMaterial(cut: CutUniforms): MeshDepthMaterial {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => patchDepth(shader, cut);
  depth.customProgramCacheKey = () => `${PATCH_VERSION}-depth`;
  return depth;
}

function createTextured(material: Material | undefined, cut: CutUniforms, gl: WebGLRenderer | null, tier: QualityTier, onLoad: () => void) {
  const swatch = material?.swatch;
  const opacity = swatch?.opacity ?? 1;
  const transparent = opacity < 1;
  const m = new MeshStandardMaterial({
    color: new Color(swatch?.color ?? NEUTRAL),
    roughness: swatch?.roughness ?? 0.85,
    metalness: swatch?.metalness ?? 0,
    transparent,
    opacity,
    depthWrite: !transparent,
  });
  const opts = baseOpts(cut, material, true, true);
  m.onBeforeCompile = (shader) => patch(shader, opts);
  m.customProgramCacheKey = () => PATCH_VERSION;

  const set = textureSet(material?.textureSet);
  if (set && gl) {
    const detail = TIER_SETTINGS[tier].detailMaps;
    const assign = (key: 'map' | 'normalMap' | 'roughnessMap' | 'aoMap' | 'metalnessMap', map: Parameters<typeof loadTexture>[2]) => {
      if (!set.maps.includes(map)) return;
      void loadTexture(gl, set.id, map).then((tex) => {
        if (!tex) return;
        m[key] = tex;
        if (key === 'normalMap' && needsRaNormals(tex.format)) m.defines = { ...m.defines, SLAPDASH_NORMAL_RA: '' };
        // The colour map already carries the material's colour; tint it halfway so the
        // swatch shifts the hue without darkening it twice.
        if (key === 'map') m.color.lerp(WHITE, 0.5);
        if (key === 'roughnessMap') m.roughness = 1;
        if (key === 'metalnessMap') m.metalness = 1;
        m.needsUpdate = true;
        onLoad();
      });
    };
    assign('map', 'color');
    if (detail) {
      assign('normalMap', 'normal');
      assign('roughnessMap', 'roughness');
      assign('aoMap', 'ao');
      if (swatch?.metalness) assign('metalnessMap', 'metalness');
    }
  }
  return { material: m, transparent };
}

function createBlueprint(cut: CutUniforms, material: Material | undefined) {
  const m = new MeshBasicMaterial({ color: new Color(SCENE_COLORS.paper), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const opts = baseOpts(cut, material, false, true);
  m.onBeforeCompile = (shader) => patch(shader, opts);
  m.customProgramCacheKey = () => `${PATCH_VERSION}-basic`;
  return { material: m, transparent: false };
}

function createXray(cut: CutUniforms, material: Material | undefined) {
  const m = new MeshBasicMaterial({ color: new Color(SCENE_COLORS.ink), transparent: true, opacity: 0.08, depthWrite: false });
  const opts = baseOpts(cut, material, false, false);
  m.onBeforeCompile = (shader) => patch(shader, opts);
  m.customProgramCacheKey = () => `${PATCH_VERSION}-basic`;
  return { material: m, transparent: true };
}

/**
 * Materials are cached per scene (its `CutUniforms`), per material id, mode and tier. Both
 * scenes share the programs and textures; only the uniforms differ.
 */
const caches = new WeakMap<CutUniforms, Map<string, PartMaterials>>();

export interface MaterialRequest {
  materialId: string;
  mode: RenderableMode;
  tier: QualityTier;
  cut: CutUniforms;
  catalog: CatalogIndex | null;
  gl: WebGLRenderer | null;
  /** Called when a texture arrives (redraw). */
  onLoad: () => void;
}

export function getPartMaterials(req: MaterialRequest): PartMaterials {
  let cache = caches.get(req.cut);
  if (!cache) caches.set(req.cut, (cache = new Map()));
  const key = `${req.materialId}|${req.mode}|${req.mode === 'textured' ? req.tier : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const material = req.catalog?.materials.get(req.materialId);
  const made =
    req.mode === 'blueprint'
      ? createBlueprint(req.cut, material)
      : req.mode === 'xray'
        ? createXray(req.cut, material)
        : createTextured(material, req.cut, req.gl, req.tier, req.onLoad);
  const out: PartMaterials = { ...made, depthMaterial: createDepthMaterial(req.cut) };
  cache.set(key, out);
  return out;
}

/** Inside needs back faces (the dark cut faces); outside draws front faces only. */
export function setCutSide(materials: Iterable<PartMaterials>, active: boolean): void {
  const side = active ? DoubleSide : FrontSide;
  for (const { material } of materials) {
    if (material.side !== side) {
      material.side = side;
      material.needsUpdate = true;
    }
  }
}

/** Every material made for a scene, e.g. to switch sides when the cut toggles. */
export function sceneMaterials(cut: CutUniforms): PartMaterials[] {
  return [...(caches.get(cut)?.values() ?? [])];
}
