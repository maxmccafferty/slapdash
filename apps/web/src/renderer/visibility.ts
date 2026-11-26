/**
 * The view rules: which parts the Floors slider and Look from show, and where Inside
 * cuts. Pure, so the user's view and snapshots agree, and so multi-storey levels can
 * replace the Floors mapping in one place later.
 *
 * Floors, while a project has one level (ADR-0003 §C):
 *   - Foundation: foundation, site and structure (site context) assemblies.
 *   - Floor 1: those plus floor, wall, opening and misc.
 *   - Roof: everything.
 * Inside: the roof is removed, and walls, openings, structures and misc are cut 4′ 0″
 * above the level (foundation, slab and floor are never cut).
 */
import type { Assembly, AssemblyKind, Level, Part } from '@slapdash/core';
import type { FloorId, LookFrom } from '../state/shell-store.ts';

export type { FloorId, LookFrom };

export interface VisibilityOptions {
  floor: FloorId;
  lookFrom: LookFrom;
}

/** 4′ 0″ in mm: the Inside section cut height above the level. */
export const INSIDE_CUT_HEIGHT_MM = 1219.2;

const FOUNDATION_KINDS: readonly AssemblyKind[] = ['foundation', 'site', 'structure'];
const FLOOR_1_KINDS: readonly AssemblyKind[] = [...FOUNDATION_KINDS, 'floor', 'wall', 'opening', 'misc'];

export const FLOOR_KINDS: Record<FloorId, ReadonlySet<AssemblyKind>> = {
  foundation: new Set(FOUNDATION_KINDS),
  'floor-1': new Set(FLOOR_1_KINDS),
  roof: new Set<AssemblyKind>([...FLOOR_1_KINDS, 'roof']),
};

const CUTTABLE_KINDS: ReadonlySet<AssemblyKind> = new Set(['wall', 'opening', 'structure', 'misc']);

/** Whether parts of this assembly kind are cut by the Inside section. */
export function isCuttable(kind: AssemblyKind): boolean {
  return CUTTABLE_KINDS.has(kind);
}

export function isKindVisible(kind: AssemblyKind, opts: VisibilityOptions): boolean {
  if (opts.lookFrom === 'inside' && kind === 'roof') return false;
  return FLOOR_KINDS[opts.floor].has(kind);
}

/** A part with no assembly (a broken file) stays visible, so nothing silently disappears. */
export function isPartVisible(_part: Part, assembly: Assembly | undefined, opts: VisibilityOptions): boolean {
  return assembly ? isKindVisible(assembly.kind, opts) : true;
}

/** The Inside cut height in mm (world y), or null when looking from outside. */
export function cutPlaneFor(lookFrom: LookFrom, levels: readonly Level[]): number | null {
  if (lookFrom !== 'inside') return null;
  const ground = levels.reduce((low, l) => (l.elevation_mm < low ? l.elevation_mm : low), levels[0]?.elevation_mm ?? 0);
  return ground + INSIDE_CUT_HEIGHT_MM;
}
