/**
 * Which dimension lines the Dimensions control draws, from the model (pure, in mm):
 *
 * - the overall footprint: length along the front (south) edge, width along the east edge,
 *   both on the floor, 2 ft out;
 * - the wall height (slab top to the top of the top plate) at the south-east corner;
 * - the ridge height (slab top to the top of the roof) at the east end, when the roof shows;
 * - each opening's rough-opening width along its wall, on the floor outside it.
 *
 * Labels are feet and inches with primes (`20′ 0″`), like the rest of the shell.
 */
import { MM_PER_FOOT, formatFeetInches, type Aabb, type Part, type Project, type Vec3 } from '@slapdash/core';
import { readOpening, readWall, wallFrame } from '../model/recipes.ts';
import { isContextPart, partAabb, unionAabb } from './bounds.ts';
import { toPrimes } from './units.ts';

export type DimensionKind = 'length' | 'width' | 'wall-height' | 'ridge-height' | 'opening';

export interface DimensionLine {
  id: string;
  kind: DimensionKind;
  /** Measured points, mm. */
  from: Vec3;
  to: Vec3;
  /** Where the line is drawn, relative to the measured points (mm). Extension lines join them. */
  offset: Vec3;
  label: string;
}

const OFFSET_MM = 2 * MM_PER_FOOT;
const OPENING_OFFSET_MM = 1 * MM_PER_FOOT;

export function dimensionLabel(mm: number): string {
  return toPrimes(formatFeetInches(mm, { precision: 8 }));
}

/**
 * The dimension set for the visible parts. `isVisible` is the same rule the scene uses, so
 * a hidden roof has no ridge dimension.
 */
export function dimensionSet(project: Project, isVisible: (part: Part) => boolean): DimensionLine[] {
  const lines: DimensionLine[] = [];
  const parts = Object.values(project.parts).filter((p) => !isContextPart(p) && isVisible(p));
  if (parts.length === 0) return lines;
  const kindOf = (p: Part) => project.assemblies[p.assemblyId]?.kind;
  const boxOf = (kind: string) => unionAabb(parts.filter((p) => kindOf(p) === kind).map(partAabb));

  const foundation = boxOf('foundation');
  const walls = boxOf('wall');
  const roof = boxOf('roof');
  const footprint: Aabb = foundation ?? walls ?? unionAabb(parts.map(partAabb))!;
  const base = foundation ? foundation.max.y : 0;
  const { min, max } = footprint;

  lines.push({
    id: 'length',
    kind: 'length',
    from: { x: min.x, y: 0, z: max.z },
    to: { x: max.x, y: 0, z: max.z },
    offset: { x: 0, y: 0, z: OFFSET_MM },
    label: dimensionLabel(max.x - min.x),
  });
  lines.push({
    id: 'width',
    kind: 'width',
    from: { x: max.x, y: 0, z: min.z },
    to: { x: max.x, y: 0, z: max.z },
    offset: { x: OFFSET_MM, y: 0, z: 0 },
    label: dimensionLabel(max.z - min.z),
  });

  if (walls) {
    lines.push({
      id: 'wall-height',
      kind: 'wall-height',
      from: { x: walls.max.x, y: base, z: walls.max.z },
      to: { x: walls.max.x, y: walls.max.y, z: walls.max.z },
      offset: { x: OFFSET_MM * Math.SQRT1_2, y: 0, z: OFFSET_MM * Math.SQRT1_2 },
      label: dimensionLabel(walls.max.y - base),
    });
  }

  if (roof) {
    const ridge = parts.filter((p) => kindOf(p) === 'roof').reduce((a, b) => (partAabb(b).max.y > partAabb(a).max.y ? b : a));
    const ridgeBox = partAabb(ridge);
    const z = (ridgeBox.min.z + ridgeBox.max.z) / 2;
    const x = Math.max(roof.max.x, footprint.max.x);
    lines.push({
      id: 'ridge-height',
      kind: 'ridge-height',
      from: { x, y: base, z },
      to: { x, y: roof.max.y, z },
      offset: { x: OFFSET_MM, y: 0, z: 0 },
      label: dimensionLabel(roof.max.y - base),
    });
  }

  const visibleAssemblies = new Set(parts.map((p) => p.assemblyId));
  for (const assembly of Object.values(project.assemblies)) {
    if (assembly.kind !== 'opening' || !visibleAssemblies.has(assembly.id)) continue;
    const opening = readOpening(assembly);
    if (!opening) continue;
    const wall = readWall(project.assemblies[opening.wallId]);
    const frame = wall && wallFrame(wall);
    if (!wall || !frame) continue;
    const { x: ux, z: uz } = frame.u;
    const { x: nx, z: nz } = frame.n;
    const a = opening.at;
    const b = opening.at + opening.width;
    lines.push({
      id: `opening-${assembly.id}`,
      kind: 'opening',
      from: { x: wall.start.x + ux * a, y: 0, z: wall.start.z + uz * a },
      to: { x: wall.start.x + ux * b, y: 0, z: wall.start.z + uz * b },
      offset: { x: nx * OPENING_OFFSET_MM, y: 0, z: nz * OPENING_OFFSET_MM },
      label: dimensionLabel(opening.width),
    });
  }
  return lines;
}
