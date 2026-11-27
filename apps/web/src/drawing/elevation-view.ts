/**
 * One elevation, drawn upright as seen from outside. Each visible assembly is drawn whole:
 * the 2D convex hull of its parts, filled paper and outlined in ink, painted by kind
 * (foundation, floor, walls, roof) and, within a kind, far to near. That gives the right
 * hidden lines for rectangular walls, gable and shed roofs and slabs without printing
 * every stud. Below-ground parts (footings) are clipped at the ground line.
 *
 * Opening assemblies aren't drawn as hulls (they sit inside their wall); instead each
 * opening in a wall that faces the viewer gets its rough opening and a symbol, painted
 * with its wall so a nearer wall still hides it. With Dimensions on: wall height on the
 * right, ridge height on the left, each opening's size, and a pitch triangle where the
 * slope is in the view plane.
 */
import { formatPitch, partBox, pitchFromRatio, type AssemblyKind, type Part, type Vec3 } from '@slapdash/core';
import { partAabb, unionAabb } from '../renderer/bounds.ts';
import { dimensionLabel } from '../renderer/dimensions.ts';
import { readOpening, readRoof, readWall, wallFrame, type OpeningRecipe, type WallFrame, type WallRecipe } from '../model/recipes.ts';
import type { DrawContext } from './context.ts';
import { unitLeaves, unitPieces } from './units.ts';
import { bounds2d, clipBelow, convexHull, depthAlong, partCorners, topAt } from './geometry.ts';
import { DIM, LABEL_GAP, TEXT } from './style.ts';
import { textWidth } from './dims2d.ts';
import type { Dim2d, Mark, Shape, ViewDraft } from './types.ts';
import { VIEWS, VIEW_NAMES, type ElevationId, type P2, type ViewDef } from './views.ts';

const KIND_ORDER: Partial<Record<AssemblyKind, number>> = { foundation: 0, site: 0, floor: 1, roof: 3 };
const rank = (kind: AssemblyKind) => KIND_ORDER[kind] ?? 2;
/** A wall faces the viewer when its exterior normal is within about 45° of the view direction. */
const FACING = 0.7;

/** Which elevations show the roof's slope in the view plane. */
export function pitchViews(roof: NonNullable<ReturnType<typeof readRoof>>): ElevationId[] {
  if (roof.type === 'gable') return roof.ridgeAxis === 'x' ? ['east', 'west'] : ['north', 'south'];
  if (roof.lowSide === 'north' || roof.lowSide === 'south') return ['east', 'west'];
  if (roof.lowSide === 'east' || roof.lowSide === 'west') return ['north', 'south'];
  return [];
}

const LOW_SIDE: Record<'north' | 'south' | 'east' | 'west', Vec3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};

interface Item {
  rank: number;
  depth: number;
  shapes: Shape[];
}

function rect(pt: (s: number, t: number) => P2, s0: number, s1: number, t0: number, t1: number): P2[] {
  return [pt(s0, t0), pt(s1, t0), pt(s1, t1), pt(s0, t1)];
}

/**
 * A window or door unit drawn from its parts: the frame (and casing) outlined, sash and
 * door pieces as symbol lines (so meeting rails, mullions and slider overlaps show), no
 * glass; then a dashed-style chevron on each hinged leaf pointing at its hinges, and an
 * arrow along each sliding panel. Empty when the opening has no unit parts.
 */
function unitOverlay(view: ViewDef, wall: WallRecipe, f: WallFrame, parts: readonly Part[], id: string): Shape[] {
  const pieces = unitPieces(parts, wall, f);
  if (pieces.length === 0) return [];
  const at = (u: number, y: number) =>
    view.project({ x: wall.start.x + f.u.x * u + f.n.x * wall.sheathingThickness, y, z: wall.start.z + f.u.z * u + f.n.z * wall.sheathingThickness });
  const shapes: Shape[] = [];
  const order = { trim: 0, frame: 1, door: 2, sash: 2 } as Record<string, number>;
  for (const p of [...pieces].sort((a, b) => (order[a.part.role] ?? 3) - (order[b.part.role] ?? 3))) {
    if (p.part.role === 'glass') continue;
    const points = convexHull(partCorners(p.part).map(view.project));
    if (points.length < 3) continue;
    const style = p.part.role === 'frame' || p.part.role === 'trim' ? 'outline' : 'symbol';
    shapes.push({ type: 'poly', points, style, assemblyId: id, id: `unit:${p.part.id}` });
  }
  const line = (a: P2, b: P2, key: string): Shape => ({ type: 'line', a, b, style: 'symbol', assemblyId: id, id: key });
  for (const leaf of unitLeaves(pieces)) {
    if (leaf.hinge) {
      const hingeU = leaf.hinge === 'start' ? leaf.u0 : leaf.u1;
      const latchU = leaf.hinge === 'start' ? leaf.u1 : leaf.u0;
      const mid = at(hingeU, (leaf.y0 + leaf.y1) / 2);
      shapes.push(line(at(latchU, leaf.y0), mid, `swing:${id}:${leaf.n}:a`), line(at(latchU, leaf.y1), mid, `swing:${id}:${leaf.n}:b`));
    }
    if (leaf.slides) {
      const y = (leaf.y0 + leaf.y1) / 2;
      const span = leaf.u1 - leaf.u0;
      const a = leaf.u0 + span * 0.25;
      const b = leaf.u0 + span * 0.75;
      const head = Math.min(100, span * 0.1);
      shapes.push(
        { type: 'line', a: at(a, y), b: at(b, y), style: 'symbol', assemblyId: id, id: `slide:${id}:${leaf.n}` },
        line(at(b - head, y + head * 0.6), at(b, y), `slide:${id}:${leaf.n}:a`),
        line(at(b - head, y - head * 0.6), at(b, y), `slide:${id}:${leaf.n}:b`),
      );
    }
  }
  return shapes;
}

function openingOverlay(
  view: ViewDef,
  wall: WallRecipe,
  f: WallFrame,
  o: OpeningRecipe,
  id: string,
  parts: readonly Part[] = [],
): { shapes: Shape[]; centre: P2; pt: (s: number, t: number, dy?: number) => P2 } {
  const y0 = wall.baseElevation + o.roBottom;
  const y1 = wall.baseElevation + o.roTop;
  const pt = (s: number, t: number, dy = 0) => {
    const u = o.at + s * o.width;
    return view.project({ x: wall.start.x + f.u.x * u + f.n.x * wall.sheathingThickness, y: y0 + t * (y1 - y0) + dy, z: wall.start.z + f.u.z * u + f.n.z * wall.sheathingThickness });
  };
  const shapes: Shape[] = [{ type: 'poly', points: rect(pt, 0, 1, 0, 1), style: 'opening', assemblyId: id, id: `ro:${id}` }];
  const sym = (points: P2[]): Shape => ({ type: 'poly', points, style: 'symbol', assemblyId: id });
  const line = (a: P2, b: P2): Shape => ({ type: 'line', a, b, style: 'symbol', assemblyId: id });
  const unit = unitOverlay(view, wall, f, parts, id);
  if (unit.length > 0) return { shapes: [...shapes, ...unit], centre: pt(0.5, 0.5), pt };
  switch (o.kind) {
    case 'window': {
      const over = 50 / o.width;
      shapes.push(line(pt(-over, 0, -50), pt(1 + over, 0, -50)), line(pt(0, 0.5), pt(1, 0.5)));
      break;
    }
    case 'sliding-door':
      shapes.push(sym(rect(pt, 0.03, 0.52, 0, 0.97)), sym(rect(pt, 0.48, 0.97, 0, 0.97)));
      break;
    case 'door':
      shapes.push(sym(rect(pt, 0.05, 0.95, 0, 0.97)));
      break;
  }
  return { shapes, centre: pt(0.5, 0.5), pt };
}

function meanDepth(view: ViewDef, parts: readonly Part[]): number {
  let sum = 0;
  for (const p of parts) sum += depthAlong(view, partBox(p).center);
  return sum / Math.max(1, parts.length);
}

export function elevationView(ctx: DrawContext, id: ElevationId): ViewDraft {
  const view = VIEWS[id];
  const { project, opts } = ctx;
  const groundY = -ctx.ground;
  const items: Item[] = [];
  const marks: Mark[] = [];
  const hulls = new Map<string, P2[]>();

  // Facing walls' openings, from the recipes.
  const openingsByWall = new Map<string, Array<{ id: string; recipe: OpeningRecipe }>>();
  for (const a of Object.values(project.assemblies)) {
    if (a.kind !== 'opening' || !ctx.byId.has(a.id)) continue;
    const recipe = readOpening(a);
    if (!recipe || !readWall(project.assemblies[recipe.wallId])) continue;
    const list = openingsByWall.get(recipe.wallId) ?? [];
    list.push({ id: a.id, recipe });
    openingsByWall.set(recipe.wallId, list);
  }
  const openingIds = new Set([...openingsByWall.values()].flat().map((o) => o.id));

  for (const g of ctx.groups) {
    if (openingIds.has(g.id)) continue;
    const hull = clipBelow(convexHull(g.parts.flatMap((p) => partCorners(p).map(view.project))), groundY);
    if (hull.length < 3) continue;
    hulls.set(g.id, hull);
    const shapes: Shape[] = [{ type: 'poly', points: hull, style: 'outline', assemblyId: g.id, id: `${id}:${g.id}` }];
    const wall = g.kind === 'wall' ? readWall(g.assembly) : null;
    const f = wall && wallFrame(wall);
    if (wall && f && f.n.x * view.towardViewer.x + f.n.z * view.towardViewer.z > FACING) {
      for (const o of openingsByWall.get(g.id) ?? []) {
        const overlay = openingOverlay(view, wall, f, o.recipe, o.id, ctx.byId.get(o.id)?.parts);
        shapes.push(...overlay.shapes);
        if (opts.dimensions) {
          const text = `${dimensionLabel(o.recipe.width)} × ${dimensionLabel(o.recipe.roTop - o.recipe.roBottom)}`;
          marks.push({ id: `opening-size-${o.id}`, kind: 'opening-size', shapes: [{ type: 'text', at: overlay.centre, text, size: TEXT.label, halo: true }] });
        }
      }
    }
    items.push({ rank: rank(g.kind), depth: meanDepth(view, g.parts), shapes });
  }
  items.sort((a, b) => a.rank - b.rank || b.depth - a.depth);
  const shapes = items.flatMap((i) => i.shapes);
  const all = bounds2d([...hulls.values()].flat());
  if (all) {
    shapes.push({ type: 'line', a: { x: all.minX - DIM.groundOver, y: groundY }, b: { x: all.maxX + DIM.groundOver, y: groundY }, style: 'ground', id: 'ground' });
  }

  const dims: Dim2d[] = [];
  if (opts.dimensions && all) {
    const top = (kind: AssemblyKind) => unionAabb(ctx.groups.filter((g) => g.kind === kind).flatMap((g) => g.parts.map(partAabb)))?.max.y;
    const hullBox = (kind: AssemblyKind) => bounds2d(ctx.groups.filter((g) => g.kind === kind).flatMap((g) => hulls.get(g.id) ?? []));
    const wallTop = top('wall');
    const walls = hullBox('wall');
    if (wallTop !== undefined && walls) {
      dims.push({
        id: `wall-height-${id}`,
        kind: 'wall-height',
        a: { x: walls.maxX, y: -ctx.base },
        b: { x: walls.maxX, y: -wallTop },
        offset: { x: all.maxX - walls.maxX + DIM.heightOffset, y: 0 },
        label: dimensionLabel(wallTop - ctx.base),
      });
    }
    const roofTop = top('roof');
    const roofs = hullBox('roof');
    if (roofTop !== undefined && roofs) {
      dims.push({
        id: `ridge-height-${id}`,
        kind: 'ridge-height',
        a: { x: roofs.minX, y: -ctx.base },
        b: { x: roofs.minX, y: -roofTop },
        offset: { x: -(roofs.minX - all.minX) - DIM.heightOffset, y: 0 },
        label: dimensionLabel(roofTop - ctx.base),
      });
    }
    for (const g of ctx.groups) {
      if (g.kind !== 'roof') continue;
      const roof = readRoof(g.assembly);
      const hull = hulls.get(g.id);
      if (!roof || !hull || !pitchViews(roof).includes(id)) continue;
      const mark = pitchMark(view, roof, hull, id);
      if (mark) marks.push(mark);
      break;
    }
  }

  return { title: VIEW_NAMES[id], shapes, dims, marks };
}

/** The pitch triangle on the slope, near the eave: a run leg, a rise leg and the pitch. */
function pitchMark(view: ViewDef, roof: NonNullable<ReturnType<typeof readRoof>>, hull: P2[], id: ElevationId): Mark | null {
  const box = bounds2d(hull)!;
  const minY = box.minY;
  const peakXs = hull.filter((p) => p.y - minY < 1).map((p) => p.x);
  // s = +1: the slope falls to the right on the sheet; −1: it rises to the right.
  let s = 1;
  let peakX = (Math.min(...peakXs) + Math.max(...peakXs)) / 2;
  if (roof.type === 'shed' && roof.lowSide) {
    s = view.project(LOW_SIDE[roof.lowSide]).x > 0 ? 1 : -1;
    peakX = s > 0 ? Math.min(...peakXs) : Math.max(...peakXs);
  }
  const eaveX = s > 0 ? box.maxX : box.minX;
  const span = Math.abs(eaveX - peakX);
  if (span <= 0) return null;
  const ax = peakX + s * 0.3 * span;
  const run = Math.min(DIM.pitchRun, 0.5 * span);
  const ratio = roof.pitchRise / 12;
  const ay = topAt(hull, ax);
  if (ay === null) return null;
  const lift = 4 * 25.4;
  const A = { x: ax, y: ay - lift };
  const C = { x: ax + s * run, y: A.y + run * ratio };
  const B = { x: C.x, y: A.y };
  const size = TEXT.label;
  const riseText = String(Math.round(roof.pitchRise * 4) / 4);
  const pitchText = formatPitch(pitchFromRatio(ratio));
  const midAB = (A.x + B.x) / 2;
  return {
    id: `pitch-${id}`,
    kind: 'pitch',
    shapes: [
      { type: 'line', a: A, b: B, style: 'dim' },
      { type: 'line', a: B, b: C, style: 'dim' },
      { type: 'text', at: { x: midAB, y: A.y - LABEL_GAP - size / 2 }, text: '12', size, halo: true },
      { type: 'text', at: { x: B.x + s * (LABEL_GAP + textWidth(riseText, size) / 2), y: (B.y + C.y) / 2 }, text: riseText, size, halo: true },
      { type: 'text', at: { x: midAB, y: A.y - 2 * LABEL_GAP - size * 1.5 }, text: pitchText, size, halo: true, id: `pitch-label-${id}` },
    ],
  };
}
