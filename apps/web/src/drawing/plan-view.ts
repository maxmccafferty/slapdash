/**
 * The plan, cut at 4′ 0″ above the lowest level (the same height as Look from: Inside):
 *
 * - cut walls as dark poché bands from the wall recipe, with gaps at openings whose rough
 *   opening spans the cut, and an opening symbol in each gap;
 * - other cuttable parts (structures, misc, walls without a recipe) as their section;
 * - the foundation and floors below the cut as outlines;
 * - the roof overhead, dashed, with its ridge;
 * - wall lengths and opening widths outside each wall, and the footprint as a subtitle.
 */
import { partAabb, unionAabb } from '../renderer/bounds.ts';
import { dimensionLabel } from '../renderer/dimensions.ts';
import { INSIDE_CUT_HEIGHT_MM, cutPlaneFor, isCuttable } from '../renderer/visibility.ts';
import { readOpening, readRoof, readWall, wallFrame, type OpeningRecipe, type WallFrame, type WallRecipe } from '../model/recipes.ts';
import { groupsOf, type DrawContext } from './context.ts';
import { bounds2d, convexHull, partCorners, sectionAtY } from './geometry.ts';
import { DIM } from './style.ts';
import type { Dim2d, Shape, ViewDraft } from './types.ts';
import type { P2 } from './views.ts';

export const PLAN_TITLE = `Plan at ${dimensionLabel(INSIDE_CUT_HEIGHT_MM)}`;

/** A point on a wall: `u` along it from its start, `o` out from the framing's outside face (negative is inside). */
function wallPoint(wall: WallRecipe, f: WallFrame, u: number, o: number): P2 {
  return { x: wall.start.x + f.u.x * u + f.n.x * o, y: wall.start.z + f.u.z * u + f.n.z * o };
}

function band(wall: WallRecipe, f: WallFrame, u0: number, u1: number, o0: number, o1: number): P2[] {
  return [wallPoint(wall, f, u0, o0), wallPoint(wall, f, u1, o0), wallPoint(wall, f, u1, o1), wallPoint(wall, f, u0, o1)];
}

/** [u0, u1] without the gaps. */
function subtract(u0: number, u1: number, gaps: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  let pieces: Array<[number, number]> = [[u0, u1]];
  for (const [g0, g1] of gaps) {
    pieces = pieces.flatMap(([a, b]): Array<[number, number]> => {
      if (g1 <= a || g0 >= b) return [[a, b]];
      const out: Array<[number, number]> = [];
      if (g0 > a) out.push([a, g0]);
      if (g1 < b) out.push([g1, b]);
      return out;
    });
  }
  return pieces.filter(([a, b]) => b - a > 1e-6);
}

function openingSymbol(wall: WallRecipe, f: WallFrame, o: OpeningRecipe, id: string): Shape[] {
  const a = o.at;
  const b = o.at + o.width;
  const d = wall.depth;
  const p = (u: number, off: number) => wallPoint(wall, f, u, off);
  const line = (u0: number, o0: number, u1: number, o1: number): Shape => ({ type: 'line', a: p(u0, o0), b: p(u1, o1), style: 'symbol', assemblyId: id });
  switch (o.kind) {
    case 'window':
      return [
        line(a, wall.sheathingThickness, b, wall.sheathingThickness),
        line(a, -d, b, -d),
        line(a, -d / 2, b, -d / 2),
        line(a, wall.sheathingThickness, a, -d),
        line(b, wall.sheathingThickness, b, -d),
      ];
    case 'sliding-door': {
      const t = 30;
      const w = o.width;
      return [
        { type: 'poly', points: band(wall, f, a, a + w * 0.52, -d * 0.3 + t / 2, -d * 0.3 - t / 2), style: 'opening', assemblyId: id },
        { type: 'poly', points: band(wall, f, a + w * 0.48, b, -d * 0.7 + t / 2, -d * 0.7 - t / 2), style: 'opening', assemblyId: id },
      ];
    }
    case 'door': {
      // Hinged at the start jamb, swinging inside (away from the exterior).
      const hinge = p(a, -d);
      const leafEnd = p(a, -d - o.width);
      return [
        { type: 'line', a: hinge, b: leafEnd, style: 'symbol', assemblyId: id },
        { type: 'arc', center: hinge, from: leafEnd, to: p(b, -d), style: 'symbol', assemblyId: id },
      ];
    }
  }
}

export function planView(ctx: DrawContext): ViewDraft {
  const { project, opts } = ctx;
  const cut = cutPlaneFor('inside', project.levels)!;
  const below: Shape[] = [];
  const cuts: Shape[] = [];
  const symbols: Shape[] = [];
  const overhead: Shape[] = [];
  const dims: Dim2d[] = [];
  const plan = (v: { x: number; z: number }): P2 => ({ x: v.x, y: v.z });

  // Openings by wall, from the recipes, with their own assembly ids.
  const openingsByWall = new Map<string, Array<{ id: string; recipe: OpeningRecipe }>>();
  for (const g of groupsOf(ctx, 'opening')) {
    const recipe = readOpening(g.assembly);
    if (!recipe) continue;
    const list = openingsByWall.get(recipe.wallId) ?? [];
    list.push({ id: g.id, recipe });
    openingsByWall.set(recipe.wallId, list);
  }
  const drawnByRecipe = new Set<string>();

  for (const g of groupsOf(ctx, 'wall')) {
    const wall = readWall(g.assembly);
    const f = wall && wallFrame(wall);
    if (!wall || !f) continue;
    drawnByRecipe.add(g.id);
    const openings = openingsByWall.get(g.id) ?? [];
    const rel = cut - wall.baseElevation;
    const gaps: Array<[number, number]> = [];
    for (const o of openings) {
      drawnByRecipe.add(o.id);
      if (o.recipe.roBottom <= rel && rel <= o.recipe.roTop) {
        gaps.push([o.recipe.at, o.recipe.at + o.recipe.width]);
        symbols.push(...openingSymbol(wall, f, o.recipe, o.id));
      }
    }
    for (const [u0, u1] of subtract(wall.frameU0, wall.frameU1, gaps)) {
      cuts.push({ type: 'poly', points: band(wall, f, u0, u1, 0, -wall.depth), style: 'cut', assemblyId: g.id, id: `cut:${g.id}` });
    }
    if (wall.sheathingThickness > 0) {
      for (const [u0, u1] of subtract(wall.sheathU0, wall.sheathU1, gaps)) {
        cuts.push({ type: 'poly', points: band(wall, f, u0, u1, wall.sheathingThickness, 0), style: 'cut', assemblyId: g.id, id: `cut:${g.id}` });
      }
    }
    if (opts.dimensions) {
      dims.push({
        id: `wall-length-${g.id}`,
        kind: 'wall-length',
        a: wallPoint(wall, f, 0, 0),
        b: wallPoint(wall, f, wall.length, 0),
        offset: { x: f.n.x * DIM.wallOffset, y: f.n.z * DIM.wallOffset },
        label: dimensionLabel(wall.length),
      });
      for (const o of openings) {
        dims.push({
          id: `opening-${o.id}`,
          kind: 'opening',
          a: wallPoint(wall, f, o.recipe.at, 0),
          b: wallPoint(wall, f, o.recipe.at + o.recipe.width, 0),
          offset: { x: f.n.x * DIM.openingOffset, y: f.n.z * DIM.openingOffset },
          label: dimensionLabel(o.recipe.width),
        });
      }
    }
  }

  for (const g of ctx.groups) {
    if (drawnByRecipe.has(g.id)) continue;
    if (g.kind === 'roof') {
      const hull = convexHull(g.parts.flatMap((p) => partCorners(p).map(plan)));
      if (hull.length < 3) continue;
      overhead.push({ type: 'poly', points: hull, style: 'overhead', assemblyId: g.id, id: `roof:${g.id}` });
      const roof = readRoof(g.assembly);
      const box = bounds2d(hull)!;
      if (roof?.type === 'gable') {
        const ridge: Shape =
          roof.ridgeAxis === 'x'
            ? { type: 'line', a: { x: box.minX, y: (roof.from.z + roof.to.z) / 2 }, b: { x: box.maxX, y: (roof.from.z + roof.to.z) / 2 }, style: 'overhead' }
            : { type: 'line', a: { x: (roof.from.x + roof.to.x) / 2, y: box.minY }, b: { x: (roof.from.x + roof.to.x) / 2, y: box.maxY }, style: 'overhead' };
        overhead.push({ ...ridge, assemblyId: g.id, id: `ridge:${g.id}` });
      }
    } else if (isCuttable(g.kind)) {
      for (const part of g.parts) {
        const section = sectionAtY(part, cut);
        if (section) cuts.push({ type: 'poly', points: section, style: 'cut', assemblyId: g.id, id: `cut:${g.id}` });
      }
    } else {
      const hull = convexHull(g.parts.flatMap((p) => partCorners(p).map(plan)));
      if (hull.length >= 3) below.push({ type: 'poly', points: hull, style: 'outline', assemblyId: g.id, id: `plan:${g.id}` });
    }
  }

  // The footprint, by the same rule as the 3D dimensions: foundation, else walls, else everything.
  const boxOf = (kind?: string) => unionAabb(ctx.groups.filter((g) => !kind || g.kind === kind).flatMap((g) => g.parts.map(partAabb)));
  const footprint = boxOf('foundation') ?? boxOf('wall') ?? boxOf();
  const subtitle = footprint
    ? `Footprint ${dimensionLabel(footprint.max.x - footprint.min.x)} × ${dimensionLabel(footprint.max.z - footprint.min.z)}`
    : undefined;

  return { title: PLAN_TITLE, subtitle, shapes: [...below, ...cuts, ...symbols, ...overhead], dims, marks: [] };
}
