/**
 * Window and door units on the sheet, from their parts (frame jambs, head and sill, sash
 * stiles and rails, glass, door slabs; see core `opening-unit`). Each piece is placed in
 * its wall's frame: `u` along the wall from its start, `o` out from the framing's outside
 * face (negative is inside), `y` up in world mm. Openings without unit parts (pre-unit
 * projects with one `panel`, or no unit at all) keep the recipe symbols.
 */
import { isUnitPart, unitPiece, unitSash, type Part } from '@slapdash/core';
import type { WallFrame, WallRecipe } from '../model/recipes.ts';
import { partCorners } from './geometry.ts';

export interface UnitPiece {
  part: Part;
  u0: number;
  u1: number;
  o0: number;
  o1: number;
  y0: number;
  y1: number;
}

/** A sash, door leaf or sliding panel: its pieces' extent and how it moves. */
export interface UnitLeaf {
  n: number;
  u0: number;
  u1: number;
  o0: number;
  o1: number;
  y0: number;
  y1: number;
  hinge: 'start' | 'end' | null;
  slides: boolean;
}

export function unitPieces(parts: readonly Part[], wall: WallRecipe, f: WallFrame): UnitPiece[] {
  const out: UnitPiece[] = [];
  for (const part of parts) {
    if (!isUnitPart(part)) continue;
    let u0 = Infinity;
    let u1 = -Infinity;
    let o0 = Infinity;
    let o1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of partCorners(part)) {
      const dx = c.x - wall.start.x;
      const dz = c.z - wall.start.z;
      const u = dx * f.u.x + dz * f.u.z;
      const o = dx * f.n.x + dz * f.n.z;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      o0 = Math.min(o0, o);
      o1 = Math.max(o1, o);
      y0 = Math.min(y0, c.y);
      y1 = Math.max(y1, c.y);
    }
    out.push({ part, u0, u1, o0, o1, y0, y1 });
  }
  return out;
}

/** The unit's sashes, leaves and panels (pieces tagged `sash:<n>`), by number. */
export function unitLeaves(pieces: readonly UnitPiece[]): UnitLeaf[] {
  const byN = new Map<number, UnitLeaf>();
  for (const p of pieces) {
    const n = unitSash(p.part);
    if (n === null || p.part.role === 'frame' || p.part.role === 'trim') continue;
    const hinge = p.part.tags.includes('hinge:start') ? 'start' : p.part.tags.includes('hinge:end') ? 'end' : null;
    const slides = p.part.tags.some((t) => t.startsWith('slides:'));
    const l = byN.get(n);
    if (!l) {
      byN.set(n, { n, u0: p.u0, u1: p.u1, o0: p.o0, o1: p.o1, y0: p.y0, y1: p.y1, hinge, slides });
      continue;
    }
    l.u0 = Math.min(l.u0, p.u0);
    l.u1 = Math.max(l.u1, p.u1);
    l.o0 = Math.min(l.o0, p.o0);
    l.o1 = Math.max(l.o1, p.o1);
    l.y0 = Math.min(l.y0, p.y0);
    l.y1 = Math.max(l.y1, p.y1);
    l.hinge ??= hinge;
    l.slides ||= slides;
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

export const isJamb = (p: UnitPiece) => unitPiece(p.part) === 'jamb';
