/**
 * The Inside section cut (ADR-0003 §C): walls, openings and structures are cut 4′ 0″ above
 * the level, and what the cut exposes is drawn dark.
 *
 * A batch can mix assembly kinds (2×4s in walls and in a floor), so the cut can't be a
 * material clipping plane. Each instance carries `aCuttable` (1 for cuttable kinds), and
 * the fragment shader discards cuttable fragments above `uCutY`. With the top of a box
 * gone you see its inside, i.e. its back faces, which the shader paints `key-dark`: those
 * are the cut faces.
 *
 * One `CutUniforms` per scene: the user's view and a snapshot can cut differently.
 */
import { Color } from 'three';
import { SCENE_COLORS } from '../styles/tokens.ts';

export interface CutUniforms {
  uCutActive: { value: number };
  /** World y, metres. */
  uCutY: { value: number };
  uCutColor: { value: Color };
}

export function createCutUniforms(): CutUniforms {
  return {
    uCutActive: { value: 0 },
    uCutY: { value: 0 },
    uCutColor: { value: new Color(SCENE_COLORS.keyDark) },
  };
}

/** Set the cut: `y_m` in metres, or null for no cut. Returns true when anything changed. */
export function setCut(uniforms: CutUniforms, y_m: number | null): boolean {
  const active = y_m === null ? 0 : 1;
  const y = y_m ?? 0;
  if (uniforms.uCutActive.value === active && uniforms.uCutY.value === y) return false;
  uniforms.uCutActive.value = active;
  uniforms.uCutY.value = y;
  return true;
}
