/**
 * The 2D drawing sheet as data (ADR-0003 §C/§D): the plan cut at 4′ 0″ in the middle, the
 * North elevation above it, South below, West and East either side, with dimensions and a
 * north arrow, on a 1′ dot grid. Built from the parts model (not screenshots), so the same
 * `Sheet` draws on screen and exports as page 1 of the PDF.
 *
 * Memoised per project object and options: the project is immutable.
 */
import { MM_PER_FOOT, type Project } from '@slapdash/core';
import { drawContext, type SheetOptions } from './context.ts';
import { dimBounds, shapeBounds, textBounds } from './dims2d.ts';
import { elevationView } from './elevation-view.ts';
import { translateBox, unionBox, type Box2 } from './geometry.ts';
import { PLAN_TITLE, planView } from './plan-view.ts';
import { LAYOUT, TEXT } from './style.ts';
import type { DrawingView, Sheet, TextShape, ViewDraft } from './types.ts';
import type { P2, ViewId } from './views.ts';

export type { SheetOptions };
export type * from './types.ts';

export const EMPTY_CAPTION = 'Nothing to draw yet.';

function finishView(id: ViewId, draft: ViewDraft): DrawingView | null {
  let found: Box2 | null = null;
  for (const s of draft.shapes) found = unionBox(found, shapeBounds(s));
  if (!found) return null;
  let box: Box2 = found;
  for (const d of draft.dims) box = unionBox(box, dimBounds(d))!;
  for (const m of draft.marks) for (const s of m.shapes) box = unionBox(box, shapeBounds(s))!;
  const cx = (box.minX + box.maxX) / 2;
  const labels: TextShape[] = [];
  let y = box.maxY + LAYOUT.titleGap + TEXT.title / 2;
  labels.push({ type: 'text', at: { x: cx, y }, text: draft.title, size: TEXT.title, weight: 600, id: `title-${id}` });
  if (draft.subtitle) {
    y += TEXT.title / 2 + TEXT.subtitle * 0.6 + TEXT.subtitle / 2;
    labels.push({ type: 'text', at: { x: cx, y }, text: draft.subtitle, size: TEXT.subtitle, fill: 'muted', id: `subtitle-${id}` });
  }
  for (const l of labels) box = unionBox(box, textBounds(l))!;
  return { id, title: draft.title, subtitle: draft.subtitle, offset: { x: 0, y: 0 }, shapes: draft.shapes, dims: draft.dims, marks: draft.marks, labels, localBounds: box };
}

const centre = (b: Box2): P2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** Place the views around the plan (centred on the origin) with a fixed gap. */
function layout(views: Map<ViewId, DrawingView>): void {
  const plan = views.get('plan');
  const pb = plan ? plan.localBounds : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pc = centre(pb);
  if (plan) plan.offset = { x: -pc.x, y: -pc.y };
  const half = { x: (pb.maxX - pb.minX) / 2, y: (pb.maxY - pb.minY) / 2 };
  const gap = LAYOUT.gap;
  const place = (id: ViewId, f: (b: Box2, c: P2) => P2) => {
    const v = views.get(id);
    if (v) v.offset = f(v.localBounds, centre(v.localBounds));
  };
  place('north', (b, c) => ({ x: -c.x, y: -half.y - gap - b.maxY }));
  place('south', (b, c) => ({ x: -c.x, y: half.y + gap - b.minY }));
  place('west', (b, c) => ({ x: -half.x - gap - b.maxX, y: -c.y }));
  place('east', (b, c) => ({ x: half.x + gap - b.minX, y: -c.y }));
}

function snapOut(b: Box2, margin: number): Box2 {
  const down = (v: number) => Math.floor(v / MM_PER_FOOT) * MM_PER_FOOT;
  const up = (v: number) => Math.ceil(v / MM_PER_FOOT) * MM_PER_FOOT;
  return { minX: down(b.minX - margin), minY: down(b.minY - margin), maxX: up(b.maxX + margin), maxY: up(b.maxY + margin) };
}

const ORDER: readonly ViewId[] = ['plan', 'north', 'south', 'west', 'east'];
const NAMES: Record<Exclude<ViewId, 'plan'>, string> = { north: 'north', south: 'south', west: 'west', east: 'east' };

function describe(project: Project | null, views: DrawingView[]): string {
  const name = project?.name ?? 'the project';
  if (views.length === 0) return `2D drawing of ${name}: nothing drawn yet.`;
  const elevations = views.filter((v) => v.id !== 'plan').map((v) => NAMES[v.id as Exclude<ViewId, 'plan'>]);
  const list = elevations.length > 1 ? `${elevations.slice(0, -1).join(', ')} and ${elevations.at(-1)}` : (elevations[0] ?? '');
  const plan = views.some((v) => v.id === 'plan') ? PLAN_TITLE.toLowerCase() : null;
  const what = [plan, list && `${list} elevation${elevations.length > 1 ? 's' : ''}`].filter(Boolean).join(' with ');
  return `2D drawing: ${what} of ${name}.`;
}

function emptySheet(project: Project | null): Sheet {
  const { width, height } = LAYOUT.empty;
  return {
    empty: true,
    views: [],
    northArrow: null,
    caption: { type: 'text', at: { x: 0, y: 0 }, text: EMPTY_CAPTION, size: TEXT.caption, fill: 'muted', id: 'caption' },
    viewBox: { minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2 },
    grid: { spacing: LAYOUT.grid },
    description: describe(project, []),
  };
}

function build(project: Project, opts: SheetOptions): Sheet {
  const ctx = drawContext(project, opts);
  if (ctx.groups.length === 0) return emptySheet(project);
  const drafts: Array<[ViewId, ViewDraft]> = [
    ['plan', planView(ctx)],
    ['north', elevationView(ctx, 'north')],
    ['south', elevationView(ctx, 'south')],
    ['west', elevationView(ctx, 'west')],
    ['east', elevationView(ctx, 'east')],
  ];
  const views = new Map<ViewId, DrawingView>();
  for (const [id, draft] of drafts) {
    const v = finishView(id, draft);
    if (v) views.set(id, v);
  }
  if (views.size === 0) return emptySheet(project);
  layout(views);
  const list = ORDER.map((id) => views.get(id)).filter((v): v is DrawingView => !!v);
  let box: Box2 | null = null;
  for (const v of list) box = unionBox(box, translateBox(v.localBounds, v.offset));
  // The north arrow in the corner above and right of the plan.
  let northArrow: Sheet['northArrow'] = null;
  const plan = views.get('plan');
  if (plan) {
    const pb = translateBox(plan.localBounds, plan.offset);
    const r = LAYOUT.northRadius;
    northArrow = { at: { x: pb.maxX + r, y: pb.minY - r }, r };
    box = unionBox(box, { minX: pb.maxX, minY: pb.minY - 2 * r - TEXT.north, maxX: pb.maxX + 2 * r, maxY: pb.minY });
  }
  return {
    empty: false,
    views: list,
    northArrow,
    caption: null,
    viewBox: snapOut(box!, LAYOUT.margin),
    grid: { spacing: LAYOUT.grid },
    description: describe(project, list),
  };
}

const cache = new WeakMap<Project, Map<string, Sheet>>();
const emptyCache = new Map<string, Sheet>();

export function buildSheet(project: Project | null, opts: SheetOptions): Sheet {
  const key = `${opts.floor}|${opts.dimensions ? 1 : 0}|${opts.steps ? [...opts.steps].sort().join(',') : '*'}`;
  if (!project) {
    let s = emptyCache.get(key);
    if (!s) emptyCache.set(key, (s = emptySheet(null)));
    return s;
  }
  let byKey = cache.get(project);
  if (!byKey) cache.set(project, (byKey = new Map()));
  let sheet = byKey.get(key);
  if (!sheet) byKey.set(key, (sheet = build(project, opts)));
  return sheet;
}
