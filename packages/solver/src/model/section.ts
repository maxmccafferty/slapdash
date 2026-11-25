/**
 * Section properties for a member: rectangles from the part's own width × height, and
 * I-joists from the catalog section's flange and web dimensions. Local y is across the
 * width (b), local z across the height (h).
 */
import type { Part, Section } from '@slapdash/core';

export interface MemberSection {
  shape: 'rect' | 'i';
  /** Width along local y, mm. */
  b: number;
  /** Depth along local z, mm. */
  h: number;
  A: number;
  /** About local y (bending in the x–z plane). */
  Iy: number;
  /** About local z (bending in the x–y plane). */
  Iz: number;
  J: number;
  /** Section moduli Iy/(h/2) and Iz/(b/2). */
  Sy: number;
  Sz: number;
}

/** Saint-Venant torsion constant of a solid rectangle: β·a·b³ with a ≥ b. */
export function rectTorsion(w: number, d: number): number {
  const a = Math.max(w, d);
  const b = Math.min(w, d);
  const beta = 1 / 3 - 0.21 * (b / a) * (1 - b ** 4 / (12 * a ** 4));
  return beta * a * b ** 3;
}

export function rectSection(b: number, h: number): MemberSection {
  const Iy = (b * h ** 3) / 12;
  const Iz = (h * b ** 3) / 12;
  return { shape: 'rect', b, h, A: b * h, Iy, Iz, J: rectTorsion(b, h), Sy: Iy / (h / 2), Sz: Iz / (b / 2) };
}

/**
 * An I section with flanges `bf × tf` and a web `tw`, depth `d` along local z. The
 * catalog stores flange width as `width`, flange thickness as `thickness` and web
 * thickness as `wall`.
 */
export function iSection(bf: number, d: number, tf: number, tw: number): MemberSection {
  const hw = d - 2 * tf;
  const A = 2 * bf * tf + tw * hw;
  const Iy = (bf * d ** 3 - (bf - tw) * hw ** 3) / 12;
  const Iz = (2 * tf * bf ** 3) / 12 + (hw * tw ** 3) / 12;
  const J = (2 * bf * tf ** 3 + hw * tw ** 3) / 3;
  return { shape: 'i', b: bf, h: d, A, Iy, Iz, J, Sy: Iy / (d / 2), Sz: Iz / (bf / 2) };
}

export function memberSection(part: Part, section: Section | undefined): MemberSection {
  if (section?.shape === 'i-beam' && section.dims_mm.thickness && section.dims_mm.wall) {
    return iSection(section.dims_mm.width, section.dims_mm.depth, section.dims_mm.thickness, section.dims_mm.wall);
  }
  return rectSection(part.size.width, part.size.height);
}
