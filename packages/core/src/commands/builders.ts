/**
 * Builder tools (ADR-0002 §A4): Claude says what to build; these lay out every stud,
 * header, joist, fastener and joint deterministically. Each builder is one command
 * and one history entry. Its redo is the resulting entity patch (`patch_entities`),
 * so redo after undo recreates exactly the same IDs.
 */
import { z } from 'zod';
import { checkCatalogRefs, emit, fail, type JointSpec, type Layout, type LayoutResult } from '../builders/emit.ts';
import { contactJoints } from '../builders/contact.ts';
import { zBuilderMaterials } from '../builders/defaults.ts';
import { SPACINGS, largestHeader, pickHeader } from '../builders/rules.ts';
import { builderSeq, fi, requireMaterial, sectionDims, snowLoad, zBuilderName, zPlanPoint } from '../builders/util.ts';
import { FENCE_STYLES, layoutFence } from '../builders/layout/fence.ts';
import { layoutDeck } from '../builders/layout/deck.ts';
import { layoutFloor } from '../builders/layout/floor.ts';
import { layoutPergola } from '../builders/layout/pergola.ts';
import {
  bottomPlates,
  frameHeader,
  frameOpening,
  headerHeight,
  headerName,
  parseHeaderSize,
  resolveOpening,
  openingParams,
  openingParamsOf,
  zOpeningFields,
  zOpeningItem,
  type ExistingOpening,
  type OpeningInput,
  type OpeningParams,
  type ResolvedOpening,
} from '../builders/layout/opening.ts';
import { unframeOpening } from '../builders/layout/reframe-opening.ts';
import { layoutRoof } from '../builders/layout/roof.ts';
import { layoutSlab } from '../builders/layout/slab.ts';
import { STRUCTURE_KINDS, layoutStructure } from '../builders/layout/structure.ts';
import { layoutWall, neighbourMembers, openingUnitMaterial, openingsIn, resolveWall, supportJoints } from '../builders/layout/wall.ts';
import { OPENING_BUILDER, WALL_BUILDER, hasTag, keepUnchangedParts, loadWallState, removeItem, studTop, wallParamsOf, type WallParams, type WallState } from '../builders/layout/wall-state.ts';
import type { FrameBox } from '../geometry/frame.ts';
import { describeClashes, findClashes } from '../model/clash.ts';
import { jointsForParts } from '../model/queries.ts';
import type { Assembly, Project } from '../model/schema.ts';
import { MM_PER_INCH } from '../units/length.ts';
import { LENGTH_DESCRIPTION, zLength, zPitch, zPositiveLength } from '../units/zod.ts';
import { zId } from './common.ts';
import { commandError, formatErrors, notFound, type CommandError } from './errors.ts';
import { patchWithInverse } from './internal.ts';
import { defineCommand, type CommandContext } from './types.ts';

/** Catalog, then clash checks on a finished layout. */
function validateLayout(project: Project, layout: Layout, ctx: CommandContext): CommandError[] {
  const refs = checkCatalogRefs(project, layout, ctx.catalog);
  if (refs.length > 0) return refs;
  const ignore = new Set(layout.remove?.parts ?? []);
  const byKey = new Map(layout.parts.map((p) => [p.key, p]));
  const clashes = findClashes(
    project,
    layout.parts.map((p) => ({ id: p.key, position: p.position, rotation: p.rotation, size: p.size, ...(p.cuts ? { cuts: p.cuts } : {}) })),
    { ignore, ...(layout.clashSkip ? { skip: (c, e) => layout.clashSkip!(byKey.get(c.id)!, e) } : {}) },
  );
  return clashes.length > 0 ? [describeClashes(project, clashes, layout.what)] : [];
}

/**
 * A specific window or door unit may not take the 16d nails contact framing uses (vinyl
 * windows are nailed through their fin with roofing nails). Re-type joints to an opening
 * unit to the first of these that both sides accept.
 */
const OPENING_JOINT_FALLBACKS = ['nailed-16d', 'nailed-roofing', 'screwed-structural'];
function fitOpeningJoints(project: Project, res: LayoutResult, ctx: CommandContext): LayoutResult {
  if (!res.ok) return res;
  const specs = new Map(res.layout.parts.map((p) => [p.key, p]));
  const materialOf = (ref: string) => ctx.catalog.materials.get(specs.get(ref)?.materialId ?? project.parts[ref]?.materialId ?? '');
  let changed = false;
  const joints = res.layout.joints.map((j) => {
    const a = materialOf(j.a);
    const b = j.b === 'GROUND' ? undefined : materialOf(j.b);
    if (a?.category !== 'opening' && b?.category !== 'opening') return j;
    const ok = (id: string) => (a?.acceptsJoints.includes(id) ?? true) && (b?.acceptsJoints.includes(id) ?? true);
    if (ok(j.jointTypeId)) return j;
    const alt = OPENING_JOINT_FALLBACKS.find(ok);
    if (!alt) return j;
    changed = true;
    return { ...j, jointTypeId: alt };
  });
  return changed ? { ok: true, layout: { ...res.layout, joints } } : res;
}

function builderCommand<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  layout: (project: Project, input: z.output<S>, ctx: CommandContext) => LayoutResult;
}) {
  return defineCommand({
    name: def.name,
    description: def.description,
    exposed: true,
    schema: def.schema,
    check(project, input, ctx) {
      const res = fitOpeningJoints(project, def.layout(project, input, ctx), ctx);
      return res.ok ? validateLayout(project, res.layout, ctx) : res.errors;
    },
    apply(project, input, ctx) {
      const res = fitOpeningJoints(project, def.layout(project, input, ctx), ctx);
      if (!res.ok) throw new Error(formatErrors(res.errors));
      const out = emit(project, res.layout);
      const patch = { put: out.put, remove: out.remove, counters: out.counters };
      const { project: next, inverse } = patchWithInverse({ ...project, counters: out.counters }, { put: out.put, remove: out.remove });
      const summary = [res.layout.summary(out.resolve), ...res.layout.notes].join(' ');
      // Joint IDs are left out of `created` to keep tool results short; they're in the project.
      const created = out.created.filter((id) => !/^J\d+$/.test(id));
      return { project: next, inverse, redo: { name: 'patch_entities', input: patch }, summary, created };
    },
  });
}

const materials = zBuilderMaterials.optional();

// ── pour_slab ───────────────────────────────────────────────────────────────

export const pourSlab = builderCommand({
  name: 'pour_slab',
  description:
    'Pour a rectangular concrete slab on grade, with thickened-edge footings by default. Corners are plan points (+x east, +z south). Creates a foundation assembly (FD1, …) that walls and floors placed on it detect automatically.',
  schema: z.strictObject({
    from: zPlanPoint.describe('One corner of the slab on the plan.'),
    to: zPlanPoint.describe('The opposite corner of the slab on the plan.'),
    thickness: zPositiveLength.optional().describe(`Slab thickness, at least 3 1/2in. Default 4in. ${LENGTH_DESCRIPTION}`),
    top: zLength.optional().describe(`Elevation of the top of the slab above grade. Default 4in. ${LENGTH_DESCRIPTION}`),
    thickenedEdge: z
      .boolean()
      .optional()
      .describe('Thickened-edge footings 12in wide around the perimeter, down to the frost depth (min 12in). Default true.'),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutSlab(project, input, ctx.catalog, ctx.siteDefaults),
});

// ── build_wall ──────────────────────────────────────────────────────────────

const WALL_CONVENTIONS =
  '"start" and "end" are plan points on the OUTSIDE face of the framing. The exterior is on the LEFT walking from start to end in a north-up plan, so list walls clockwise (or set "exterior"). "height" is the overall framed height, bottom of the bottom plate to the top of the double top plate: "9ft" gives 103 1/2in studs. The wall stands on the highest slab or floor under it (or on the ground). If an end lands on the end of an existing wall\'s outside face, it butts into that wall as a California corner (framing shortened, sheathing lapped, a backer stud added).';

function wallLayout(project: Project, input: z.output<typeof buildWallSchema>, ctx: CommandContext): LayoutResult {
  const r = resolveWall(project, input, ctx.catalog, ctx.siteDefaults);
  if (!r.ok) return fail(...r.errors);
  const openings = input.openings ?? [];
  const productErrs = openings.flatMap((o, i) => checkProduct(o.product, ctx, `openings[${i}].product`) ?? []);
  if (productErrs.length > 0) return fail(...productErrs);
  const openingSeq = builderSeq(project, OPENING_BUILDER);
  const wl = layoutWall(project, r.params, r.butts, openings, '#w', (i) => `#o${i}`, ctx.catalog, openingSeq);
  if (wl.errors.length > 0) return fail(...wl.errors);
  const p = r.params;
  const name = input.name ?? `Wall ${p.seq + 1}`;
  const notes = [...r.notes, ...wl.notes];
  if (wl.openings.length > 0 && p.loadBearing) notes.push(`Headers are sized for ${p.snowNote} and ${p.buildingWidthNote}.`);
  const studs = wl.state.items.filter((i) => i.role === 'stud' && i.isNew && !i.tags.includes('corner-backer')).length;
  const panels = wl.state.items.filter((i) => i.role === 'sheathing').length;
  return {
    ok: true,
    layout: {
      assemblies: [
        { key: '#w', kind: 'wall', name, buildStep: { phase: 'framing', seq: p.seq }, builder: () => ({ name: WALL_BUILDER, params: { ...p } as unknown as Record<string, unknown> }) },
        ...wl.openings.map((o, i) => openingAssembly(`#o${i}`, o, '#w', name, openingSeq + i)),
      ],
      parts: wl.state.specs,
      joints: wl.joints,
      notes,
      what: 'The new wall',
      summary: (id) => {
        const corners = [p.butt.start, p.butt.end].filter((x): x is string => x !== null);
        const opening = wl.openings.map((o, i) => `${id(`#o${i}`)} (${describeOpening(o)})`);
        return (
          `Built wall ${id('#w')} "${name}": ${fi(p.length)} long, ${fi(p.height)} high, ${studs} ${p.studSectionId} studs at ${p.spacingLabel} (${fi(p.studLength)} long)` +
          (p.bracing === 'sheathing' ? `, ${panels} OSB panels` : p.bracing === 'let-in' ? ', let-in braces at both ends' : '') +
          (opening.length > 0 ? `, openings ${opening.join(', ')}` : '') +
          (corners.length > 0 ? `; butts into ${corners.join(' and ')}` : '') +
          (p.support.kind === 'concrete' ? `; anchor-bolted to ${p.support.partIds[0]}` : p.support.kind === 'wood' ? '; nailed to the floor framing' : '') +
          '.'
        );
      },
    },
  };
}

function describeOpening(o: ResolvedOpening): string {
  return `${fi(o.width)} × ${fi(o.height)} ${o.kind}, ${o.header.name} header, ${o.jacks} jack and ${o.kings} king stud${o.kings === 1 ? '' : 's'} each side`;
}

function openingAssembly(key: string, o: ResolvedOpening, wallRef: string, wallName: string, seq: number) {
  const label = o.kind === 'sliding-door' ? 'Sliding door' : o.kind === 'door' ? 'Door' : 'Window';
  return {
    key,
    kind: 'opening' as const,
    name: `${label} in ${wallName}`,
    buildStep: { phase: 'openings' as const, seq },
    builder: (id: (r: string) => string) => ({
      name: OPENING_BUILDER,
      params: openingParams(o, id(wallRef)) as unknown as Record<string, unknown>,
    }),
  };
}

/** A `product` must be a catalog opening (window or door unit). */
function checkProduct(product: string | undefined, ctx: CommandContext, path: string): CommandError | null {
  return product === undefined ? null : requireMaterial(ctx.catalog, product, ['opening'], path);
}

const buildWallSchema = z.strictObject({
  start: zPlanPoint.describe('Start of the wall: a plan point on the outside face of the framing (a building corner).'),
  end: zPlanPoint.describe('End of the wall: a plan point on the outside face of the framing.'),
  height: zPositiveLength.describe(
    `Overall framed height, bottom of the bottom plate to the top of the double top plate (e.g. 9ft → 103 1/2in studs). ${LENGTH_DESCRIPTION}`,
  ),
  studLength: zPositiveLength.optional().describe(`Use this stud length instead (e.g. precut 104 5/8in); the height follows from it. ${LENGTH_DESCRIPTION}`),
  exterior: z.enum(['left', 'right']).optional().describe('Which side is outside, walking from start to end in a north-up plan. Default left.'),
  baseElevation: zLength.optional().describe(`Bottom of the bottom plate. Default: top of the slab or floor under the wall, else the ground. ${LENGTH_DESCRIPTION}`),
  studSize: z.enum(['2x4', '2x6']).optional().describe('Stud size. Default 2x4.'),
  spacing: z.enum(SPACINGS).optional().describe('Stud spacing on center, measured from the wall start. Default 16in.'),
  loadBearing: z.boolean().optional().describe('Whether the wall carries the roof. Sets header sizes. Default true.'),
  buildingWidth: zPositiveLength
    .optional()
    .describe(`Building width for header sizing (IRC Table R602.7(1)). Default: the short side of the slab/floor under the wall. ${LENGTH_DESCRIPTION}`),
  bracing: z
    .enum(['sheathing', 'let-in', 'none'])
    .optional()
    .describe('Wall bracing: 7/16in OSB sheathing panels (default), 1x4 let-in diagonal braces at both ends, or none.'),
  openings: z.array(zOpeningItem).optional().describe('Openings to frame in the wall now. Same fields as add_opening without wallId.'),
  materials,
  name: zBuilderName.describe('Readable name, e.g. South wall.'),
});

export const buildWall = builderCommand({
  name: 'build_wall',
  description: `Frame a whole stud wall (US platform framing): pressure-treated bottom plate on concrete, double top plate, studs on layout, headers, structural sheathing and every nail joint. ${WALL_CONVENTIONS}`,
  schema: buildWallSchema,
  layout: wallLayout,
});

// ── add_opening ─────────────────────────────────────────────────────────────

const addOpeningSchema = z.strictObject({
  wallId: zId.describe('The wall to frame the opening in, e.g. W2. Must have been made with build_wall.'),
  ...zOpeningFields,
});

function openingLayout(project: Project, input: z.output<typeof addOpeningSchema>, ctx: CommandContext): LayoutResult {
  const wall = project.assemblies[input.wallId];
  const walls = Object.values(project.assemblies).filter((a) => a.kind === 'wall').map((a) => a.id);
  if (!wall || !Object.hasOwn(project.assemblies, input.wallId)) {
    const err = notFound('wall', input.wallId, walls, 'wallId');
    return fail(err.hint ? err : { ...err, hint: walls.length > 0 ? `Walls: ${walls.join(', ')}.` : 'Build a wall first with build_wall.' });
  }
  const params = wallParamsOf(project, input.wallId);
  if (!params) {
    return fail(
      commandError('not_allowed', `${wall.id} wasn't made with build_wall, so add_opening can't re-frame it.`, {
        path: 'wallId',
        hint: 'Frame the opening with add_part, or rebuild the wall with build_wall.',
      }),
    );
  }
  const state = loadWallState(project, input.wallId, params);
  const braces = state.items.filter((i) => i.role === 'brace').map((i) => i.box);
  const productErr = checkProduct(input.product, ctx, 'product');
  if (productErr) return fail(productErr);
  const r = resolveOpening(params, input, openingsIn(project, input.wallId), braces, (id) => sectionDims(ctx.catalog, id).depth);
  if (!r.ok) return fail(...r.errors);
  const unit = r.opening.product ?? openingUnitMaterial(ctx.catalog);
  const seq = builderSeq(project, OPENING_BUILDER);
  frameOpening(state, r.opening, '#o', unit ? { materialId: unit, seq } : undefined);

  const { joints, removedJoints } = openingJoints(project, state, input.wallId);

  const o = r.opening;
  return {
    ok: true,
    layout: {
      assemblies: [openingAssembly('#o', o, input.wallId, wall.name, seq)],
      parts: state.specs,
      joints,
      remove: { parts: state.removed, joints: removedJoints },
      notes: params.loadBearing ? [`The header is sized for ${params.snowNote} and ${params.buildingWidthNote}.`] : [],
      what: 'The opening\'s framing',
      summary: (id) =>
        `Framed ${id('#o')} in ${wall.id}: a ${describeOpening(o)}, ${fi(o.roU0)} from the wall's start; removed ${state.removed.filter((x) => project.parts[x]?.role === 'stud').length} common studs.`,
    },
  };
}

/**
 * Joints for a re-framed wall state: contacts between the new parts and the kept ones
 * (and the walls it butts into or that butt into it), anchors or nails under new
 * bottom plates, and the existing joints of every removed part.
 */
function openingJoints(project: Project, state: WallState, wallId: string): { joints: JointSpec[]; removedJoints: string[] } {
  const params = state.params;
  const fresh = state.items.filter((i) => i.isNew);
  const kept = state.items.filter((i) => !i.isNew && i.role !== 'brace');
  const partners = new Set<string>([params.butt.start, params.butt.end].filter((x): x is string => x !== null && Object.hasOwn(project.assemblies, x)));
  for (const asm of Object.values(project.assemblies)) {
    const p = asm.builder?.name === WALL_BUILDER ? (asm.builder.params as unknown as WallParams) : null;
    if (p && (p.butt.start === wallId || p.butt.end === wallId)) partners.add(asm.id);
  }
  const joints = contactJoints(state.frame, fresh, [...kept, ...neighbourMembers(project, state.frame, [...partners])]);
  const specMap = new Map(state.specs.map((s) => [s.key, s]));
  joints.push(...supportJoints(project, state, bottomPlates(state).filter((p) => p.isNew), specMap));
  const removedJoints = jointsForParts(project, state.removed).map((j) => j.id);
  return { joints, removedJoints };
}

export const addOpening = builderCommand({
  name: 'add_opening',
  description:
    'Frame a window or door in a wall made with build_wall: header sized from IRC Table R602.7(1), jack and king studs, cripples, a window sill, the bottom plate cut out for doors, and the sheathing cut around the rough opening. Only the common studs in the way are removed; other stud IDs stay the same. "at" is measured along the wall from its start point.',
  schema: addOpeningSchema,
  layout: openingLayout,
});

// ── frame_floor ─────────────────────────────────────────────────────────────

export const frameFloor = builderCommand({
  name: 'frame_floor',
  description:
    'Frame a rectangular platform floor: pressure-treated sill plates anchored to the foundation (or concrete piers), rim joists, joists on layout, mid-span blocking and a staggered 3/4in plywood subfloor. Corners are plan points on the outside of the rim.',
  schema: z.strictObject({
    from: zPlanPoint.describe('One corner of the floor (outside of the rim joists).'),
    to: zPlanPoint.describe('The opposite corner.'),
    top: zLength
      .optional()
      .describe(`Top of the subfloor. Default: sits on the foundation; with piers, 2ft above grade. ${LENGTH_DESCRIPTION}`),
    joistSize: z.enum(['2x6', '2x8', '2x10', '2x12']).optional().describe('Joist size. Default 2x8.'),
    spacing: z.enum(SPACINGS).optional().describe('Joist spacing on center. Default 16in.'),
    joistDirection: z.enum(['x', 'z']).optional().describe('Direction the joists run: x east-west, z north-south. Default: across the shorter side.'),
    support: z
      .enum(['foundation', 'piers'])
      .optional()
      .describe('foundation (default): sill plates on an existing slab/footing; piers: concrete piers at most 6ft apart under the joist ends.'),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutFloor(project, input, ctx.catalog, ctx.siteDefaults),
});

// ── build_roof ──────────────────────────────────────────────────────────────

export const buildRoof = builderCommand({
  name: 'build_roof',
  description:
    'Stick-frame a gable or shed roof over existing walls: common rafters on layout, a ridge board one size deeper (gable), rafter ties at each pair (gable), hurricane ties to the top plates and OSB roof sheathing. "from"/"to" are the wall footprint corners on the outside face of the framing. Bears on the walls along the eave edges unless "bearingHeight" is given.',
  schema: z.strictObject({
    type: z.enum(['gable', 'shed']).describe('Roof type.'),
    from: zPlanPoint.describe('One corner of the wall footprint (outside face of the framing).'),
    to: zPlanPoint.describe('The opposite corner.'),
    pitch: zPitch.describe('Roof pitch, 1 in 12 to 24 in 12, e.g. 6 in 12.'),
    ridgeAxis: z.enum(['x', 'z']).optional().describe('Gable only: direction of the ridge, x east-west or z north-south. Default: along the longer side.'),
    lowSide: z.enum(['north', 'south', 'east', 'west']).optional().describe('Shed only: the low eave side.'),
    rafterSize: z.enum(['2x6', '2x8', '2x10']).optional().describe('Rafter size. Default 2x6.'),
    spacing: z.enum(['12in', '16in', '24in']).optional().describe('Rafter spacing on center. Default 16in.'),
    overhang: zLength.optional().describe(`Eave overhang, measured level from the outside face of the framing. Default 12in. ${LENGTH_DESCRIPTION}`),
    rake: zLength.optional().describe(`Gable-end overhang (adds fly rafters). Default 0. ${LENGTH_DESCRIPTION}`),
    bearingHeight: zLength.optional().describe(`Top of the wall plates the rafters sit on. Default: from the walls under the eaves. ${LENGTH_DESCRIPTION}`),
    sheathing: z.boolean().optional().describe('Add 7/16in OSB roof sheathing. Default true.'),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutRoof(project, input, ctx.catalog),
});

// ── build_fence ─────────────────────────────────────────────────────────────

const zFenceGate = z
  .strictObject({
    at: zLength.optional().describe(`Where the gate opening starts, measured along the whole path from its first point. Give "at" or "centerAt". ${LENGTH_DESCRIPTION}`),
    centerAt: zLength.optional().describe(`Where the middle of the gate opening is, measured along the whole path. ${LENGTH_DESCRIPTION}`),
    width: zPositiveLength.optional().describe(`Opening between the gate posts, 3ft to 6ft. Default 4ft. ${LENGTH_DESCRIPTION}`),
    hinge: z.enum(['start', 'end']).optional().describe('Which gate post the hinges go on, the one nearer the start or the end of the path. Default start.'),
    swing: z.enum(['in', 'out']).optional().describe('in swings toward the pool side (or the left of the path), out away. Default out; a pool barrier gate must swing out.'),
  })
  .describe('A single gate in the fence line.');

export const buildFence = builderCommand({
  name: 'build_fence',
  description:
    'Build a fence along a path. Styles: privacy (1x6 boards) or picket (1x4 pickets) on 2x4 rails and pressure-treated 4x4 posts set in concrete at most 8ft apart; chain-link (galvanized terminal and line posts at most 10ft apart, top rail, fabric); aluminum (6ft panels on 2x2 posts); glass (frameless tempered panels on spigots in a concrete deck). Gates get posts on both sides, hinges and a latch. With "poolBarrier": at least 4ft tall, gaps under 4in, 1 1/4in mini-mesh for chain link, rails on the pool side, self-closing hinges and a magnetic latch 54in up, gates swinging away from the pool (IRC Appendix AG105; a reminder, not a code check).',
  schema: z.strictObject({
    path: z.array(zPlanPoint).min(2).describe('Fence line: two or more plan points; a post goes at each.'),
    height: zPositiveLength.optional().describe(`Fence height above grade, 3ft to 8ft (4ft minimum for a pool barrier, 6ft maximum for glass). Default 6ft (4ft for glass). ${LENGTH_DESCRIPTION}`),
    style: z.enum(FENCE_STYLES).optional().describe('privacy (default), picket, chain-link, aluminum or glass.'),
    postSpacing: zPositiveLength
      .optional()
      .describe(`Maximum post spacing: up to 8ft for wood (default 8ft), 10ft for chain-link (default 10ft), 6ft for aluminum (default 6ft). Ignored for glass. ${LENGTH_DESCRIPTION}`),
    infill: zId
      .optional()
      .describe('Catalog material for the boards (lumber, for wood styles) or the fabric/panels (fencing, for chain-link, aluminum and glass). Default: the style\'s own.'),
    gates: z.array(zFenceGate).max(8).optional().describe('Gates, each inside one straight run of the path.'),
    poolBarrier: z.boolean().optional().describe('Build it as a pool barrier (IRC Appendix AG105 / ISPSC 305). Default false.'),
    poolSide: z
      .enum(['left', 'right'])
      .optional()
      .describe('Which side of the path, walking from its first point, the pool is on. Default: the side facing the nearest pool, else left.'),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutFence(project, input, ctx.catalog),
});

// ── build_pergola ───────────────────────────────────────────────────────────

export const buildPergola = builderCommand({
  name: 'build_pergola',
  description:
    'Build a freestanding pergola: pressure-treated posts on post bases and concrete piers (frost depth, 12in minimum), doubled beams bolted to the post tops, rafters across them with hurricane ties, and optionally a roof of 2x4 purlins and clear polycarbonate or metal panels. Beam spans pick the post count. "from"/"to" are the outside faces of the posts.',
  schema: z.strictObject({
    from: zPlanPoint.describe('One corner of the pergola (outside face of the posts).'),
    to: zPlanPoint.describe('The opposite corner.'),
    height: zPositiveLength.optional().describe(`Top of the beams on the high side. Default 8ft. ${LENGTH_DESCRIPTION}`),
    postSize: z.enum(['4x4', '6x6']).optional().describe('Post size. Default 6x6.'),
    beamSize: z.enum(['2x8', '2x10', '2x12']).optional().describe('Doubled beam size: 2x8 spans 8ft between posts, 2x10 10ft, 2x12 12ft. Default 2x8.'),
    beamAxis: z.enum(['x', 'z']).optional().describe('Direction the beams run. Default: along the longer side (or across the low side if given).'),
    rafterSize: z.enum(['2x6', '2x8']).optional().describe('Rafter size. Default 2x6.'),
    rafterSpacing: z.enum(['12in', '16in', '24in']).optional().describe('Rafter spacing. Default 16in, or 24in with roofing.'),
    overhang: zLength.optional().describe(`How far beams and rafters run past the posts. Default 12in. ${LENGTH_DESCRIPTION}`),
    roofing: zId
      .optional()
      .describe('none (default, open), polycarbonate (clear corrugated panels), metal, or a catalog roofing material ID.'),
    slope: zPitch.optional().describe('Rafter slope, e.g. 1 in 12. Default 1 in 12 with roofing (polycarbonate needs at least that), flat when open.'),
    lowSide: z.enum(['north', 'south', 'east', 'west']).optional().describe('The low side the rafters slope down to. Default north (beams along x) or west.'),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutPergola(project, input, ctx.catalog, ctx.siteDefaults),
});

// ── build_deck ──────────────────────────────────────────────────────────────

export const buildDeck = builderCommand({
  name: 'build_deck',
  description:
    'Build a freestanding deck (no ledger to the house): 6x6 posts on piers at most 8ft apart, doubled 2x10 beams, joists sized from IRC Table R507.6, and decking screwed down with 1/8in gaps. Over 30in up it adds a 36in guard (wood balusters, cable or glass); stairs come down one side on 2x12 stringers to a concrete pad with risers at most 7 3/4in. "from"/"to" are the outside of the rim.',
  schema: z.strictObject({
    from: zPlanPoint.describe('One corner of the deck (outside of the rim joist).'),
    to: zPlanPoint.describe('The opposite corner.'),
    height: zPositiveLength.describe(`Top of the decking above grade. ${LENGTH_DESCRIPTION}`),
    joistSize: z.enum(['2x6', '2x8', '2x10', '2x12']).optional().describe('Joist size. Default: the smallest that spans (IRC R507.6); more beams are added if needed.'),
    spacing: z.enum(['12in', '16in']).optional().describe('Joist spacing. Default 16in, or 12in for composite decking (most makers require it).'),
    joistDirection: z.enum(['x', 'z']).optional().describe('Direction the joists run. Default: across the shorter side.'),
    decking: zId.optional().describe('Decking material ID: pt-syp-no2-gc (5/4x6 treated pine, default), cedar-wrc or composite-decking.'),
    railing: z
      .enum(['auto', 'none', 'wood', 'cable', 'glass'])
      .optional()
      .describe('Guard infill. auto (default): wood balusters when the deck is over 30in up, else none. none is refused over 30in (IRC R312.1.1).'),
    stairs: z
      .strictObject({
        side: z.enum(['north', 'south', 'east', 'west']).describe('The side the stairs come down from.'),
        at: zLength.describe(`Where the stairs start along that side, from its west end (north/south sides) or north end (east/west sides). ${LENGTH_DESCRIPTION}`),
        width: zPositiveLength.optional().describe(`Stair width, at least 3ft. Default 3ft. ${LENGTH_DESCRIPTION}`),
      })
      .optional()
      .describe('One flight of stairs to grade.'),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutDeck(project, input, ctx.catalog, ctx.siteDefaults),
});

// ── place_structure ─────────────────────────────────────────────────────────

export const placeStructure = builderCommand({
  name: 'place_structure',
  description:
    'Place site context that is not being built (an existing house, a pool, a tree, a shed or a box), drawn stippled. It has no joints and nothing structural is checked; new construction is not allowed to run through it.',
  schema: z.strictObject({
    kind: z.enum(STRUCTURE_KINDS).describe('What it is.'),
    at: zPlanPoint.describe('Plan point: the footprint corner (house, pool, shed, box) or the trunk centre (tree).'),
    width: zPositiveLength.optional().describe(`Extent along the rotated x direction. ${LENGTH_DESCRIPTION}`),
    depth: zPositiveLength.optional().describe(`Extent along the rotated z direction (plan, not below grade). ${LENGTH_DESCRIPTION}`),
    height: zPositiveLength.optional().describe(`Height (house: walls; tree: overall). ${LENGTH_DESCRIPTION}`),
    poolDepth: zPositiveLength.optional().describe(`Pool only: depth below grade. Default 6ft. ${LENGTH_DESCRIPTION}`),
    canopy: zPositiveLength.optional().describe(`Tree only: canopy diameter. Default 15ft. ${LENGTH_DESCRIPTION}`),
    rotation: z.number().optional().describe('Plan rotation in degrees, from +x towards +z. Default 0.'),
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutStructure(project, input, ctx.catalog),
});


// ── resize_header ───────────────────────────────────────────────────────────

const resizeHeaderSchema = z.strictObject({
  opening: zId.describe('The opening assembly made by add_opening (e.g. O1), or the ID of one of its header plies.'),
  size: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Header size, e.g. "2-2x10" (two 2x10 plies on edge), "3-2x12" or "flat 2x4". Default: sized from IRC Table R602.7(1) for the current ground snow load and the wall\'s building width.',
    ),
});

/**
 * The opening assembly a ref names: its ID, or one of its header plies. `tool` is the
 * command asking (for messages); `path` is the input field the ref came from.
 */
function findOpening(project: Project, ref: string, tool = 'resize_header', path = 'opening'): { asm: Assembly } | { error: CommandError } {
  const openings = Object.values(project.assemblies).filter((a) => a.kind === 'opening').map((a) => a.id);
  let asm = Object.hasOwn(project.assemblies, ref) ? project.assemblies[ref] : undefined;
  if (!asm && Object.hasOwn(project.parts, ref)) {
    const part = project.parts[ref]!;
    const tag = part.role === 'header' ? part.tags.find((t) => t.startsWith('opening:')) : undefined;
    if (!tag) {
      return {
        error: commandError('invalid_input', `${part.id} is a ${part.role}, not an opening's header.`, {
          path,
          hint: openings.length > 0 ? `Openings: ${openings.join(', ')}.` : 'There are no openings yet.',
        }),
      };
    }
    asm = project.assemblies[tag.slice('opening:'.length)];
  }
  if (!asm) {
    const err = notFound('opening', ref, openings, path);
    return { error: err.hint ? err : { ...err, hint: openings.length > 0 ? `Openings: ${openings.join(', ')}.` : 'There are no openings yet.' } };
  }
  if (asm.builder?.name !== OPENING_BUILDER) {
    return {
      error:
        tool === 'resize_header'
          ? commandError('not_allowed', `${asm.id} wasn't made with add_opening, so resize_header can't re-frame its header.`, {
              path,
              hint: 'Change the header parts with update_part, or frame the opening with add_opening.',
            })
          : commandError('not_allowed', `${asm.id} wasn't made with add_opening, so ${tool} can't re-frame it.`, {
              path,
              hint: 'Change its parts with update_part or delete_part, or frame the opening with add_opening.',
            }),
    };
  }
  return { asm };
}

function resizeHeaderLayout(project: Project, input: z.output<typeof resizeHeaderSchema>, ctx: CommandContext): LayoutResult {
  const found = findOpening(project, input.opening);
  if ('error' in found) return fail(found.error);
  const asm = found.asm;
  const op = openingParamsOf(asm)!;
  const wall = wallParamsOf(project, op.wallId);
  if (!wall) {
    return fail(commandError('not_allowed', `${asm.id}'s wall ${op.wallId} wasn't made with build_wall, so its header can't be re-framed.`, { path: 'opening' }));
  }
  const T = 1.5 * MM_PER_INCH;
  const maxPlies = Math.floor((wall.depth + 0.5) / T);
  const notes: string[] = [];

  // The new header.
  let header: { plies: number; sectionId: string; flat: boolean };
  let rule: string;
  let tableJacks: number | null = null;
  if (input.size !== undefined) {
    const parsed = parseHeaderSize(input.size);
    if (!parsed) {
      return fail(
        commandError('invalid_input', `Couldn't read "${input.size}" as a header size.`, {
          path: 'size',
          hint: 'Write it like "2-2x10" (two 2x10 plies), "3-2x12" or "flat 2x4".',
        }),
      );
    }
    if (!ctx.catalog.sections.has(parsed.sectionId)) return fail(notFound('section', parsed.sectionId, ctx.catalog.sections.keys(), 'size'));
    if (!parsed.flat && parsed.plies > maxPlies) {
      return fail(
        commandError('invalid_input', `A ${fi(wall.depth)}-deep ${wall.studSectionId} wall fits at most ${maxPlies} plies side by side; you asked for ${parsed.plies}.`, {
          path: 'size',
        }),
      );
    }
    header = parsed;
    rule = `${headerName(parsed)}, as asked`;
  } else if (!wall.loadBearing) {
    header = { plies: 1, sectionId: '2x4', flat: true };
    rule = 'IRC R602.7.4: flat 2x4 header in a non-bearing wall';
  } else {
    const snow = snowLoad(project, ctx.siteDefaults);
    const q = { snowPsf: snow.psf, buildingWidthFt: wall.buildingWidthFt, maxPlies };
    const choice = pickHeader({ ...q, spanMm: op.width });
    if (!choice) {
      const big = largestHeader(q);
      const why =
        snow.psf > 70
          ? `the ${Number(snow.psf.toFixed(1))} psf ground snow load is past the prescriptive header table (70 psf max)`
          : wall.buildingWidthFt > 36
            ? `a ${Number(wall.buildingWidthFt.toFixed(1))}ft-wide building is past the prescriptive header table (36ft max)`
            : `a ${fi(op.width)} opening is longer than any built-up 2x header allows here${big ? ` (${headerName({ ...big, flat: false })} max ${fi(big.maxSpanMm)})` : ''}`;
      return fail(
        commandError('not_allowed', `No header in IRC Table R602.7(1) works for ${asm.id}: ${why}. It needs an engineered beam.`, {
          path: 'opening',
          hint: 'Give an explicit "size", or ask an engineer for a beam.',
        }),
      );
    }
    header = { plies: choice.plies, sectionId: choice.sectionId, flat: false };
    tableJacks = choice.jacks;
    rule = `IRC Table R602.7(1): ${choice.snowPsf} psf, ${choice.buildingWidthFt}ft building width column`;
    notes.push(`Sized for ${snow.note} and ${wall.buildingWidthNote}.`);
  }
  const depth = header.flat ? T : sectionDims(ctx.catalog, header.sectionId).depth;
  const name = headerName(header);

  // Does it fit under the top plate?
  const top = studTop(wall, T);
  const height = headerHeight({ flat: header.flat, depth });
  if (op.roTop + height > top + 1e-6) {
    return fail(
      commandError(
        'invalid_input',
        `A ${name} header doesn't fit over ${asm.id}: the rough opening tops out at ${fi(op.roTop)} and the top plate is at ${fi(top)}, which leaves ${fi(top - op.roTop)} for a ${fi(height)}-deep header.`,
        { path: input.size !== undefined ? 'size' : 'opening', hint: 'Use a shallower header with more plies, or lower the opening.' },
      ),
    );
  }

  // Take out the old header and the cripples above it; frame the new ones.
  const state = loadWallState(project, op.wallId, wall);
  const tag = `opening:${asm.id}`;
  for (const item of [...state.items]) {
    const ours = hasTag(item, tag);
    if (ours && item.role === 'header') removeItem(state, item);
    else if (ours && item.role === 'stud' && hasTag(item, 'cripple') && item.box.v0 >= op.roTop - 1) removeItem(state, item);
  }
  const resolvedHeader = { ...header, depth, length: op.width + 2 * op.jacks * T, name };
  frameHeader(state, { roU0: op.at, roU1: op.at + op.width, roTop: op.roTop, jacks: op.jacks, header: resolvedHeader }, asm.id);

  const fresh = state.items.filter((i) => i.isNew);
  const kept = state.items.filter((i) => !i.isNew && i.role !== 'brace');
  const joints = contactJoints(state.frame, fresh, kept);
  const removedJoints = jointsForParts(project, state.removed).map((j) => j.id);
  if (tableJacks !== null && tableJacks > op.jacks) {
    notes.push(
      `The table asks for ${tableJacks} jack studs a side for a ${name} here and ${asm.id} has ${op.jacks}; I kept the jacks as framed, so add ${tableJacks - op.jacks} more a side when it's built (re-framing the jacks moves the king studs and sheathing).`,
    );
  }

  // Say what was there, from the parts themselves (update_part may have changed them).
  const oldPlies = Object.values(project.parts).filter((x) => x.role === 'header' && x.tags.includes(tag));
  const oldSection = oldPlies[0]?.sectionId;
  const before =
    oldPlies.length > 0 && oldSection
      ? headerName({ plies: oldPlies.length, sectionId: oldSection, flat: oldPlies.length === 1 && op.header.flat })
      : headerName(op.header);
  const updated: Assembly = {
    ...asm,
    builder: {
      name: OPENING_BUILDER,
      params: {
        ...asm.builder!.params,
        header: { plies: header.plies, sectionId: header.sectionId, flat: header.flat, length: resolvedHeader.length },
        headerRule: rule,
      },
    },
  };
  const cripples = fresh.filter((i) => i.role === 'stud').length;
  return {
    ok: true,
    layout: {
      assemblies: [],
      updateAssemblies: [updated],
      parts: state.specs,
      joints,
      remove: { parts: state.removed, joints: removedJoints },
      notes,
      what: `The new ${name} header`,
      summary: () =>
        `Re-framed ${asm.id}'s header in ${op.wallId}: ${before} → ${name}` +
        (cripples > 0 ? `, with ${cripples} cripple${cripples === 1 ? '' : 's'} above it.` : ', with no room for cripples above it.'),
    },
  };
}

export const resizeHeader = builderCommand({
  name: 'resize_header',
  description:
    'Re-size the header over an opening made by add_opening, re-framing the header plies and the cripples above them (jack and king studs stay). With no "size" it picks the smallest header in IRC Table R602.7(1) for the current ground snow load and the wall\'s building width; use it to fix an over-stressed header.',
  schema: resizeHeaderSchema,
  layout: resizeHeaderLayout,
});

// ── update_opening / remove_opening ─────────────────────────────────────────

interface OpeningContext {
  op: OpeningParams;
  wall: WallParams;
  state: WallState;
  others: OpeningParams[];
  /** The other openings, labelled by assembly ID for overlap messages. */
  existing: ExistingOpening[];
  braces: FrameBox[];
}

/** An opening's recipe, its wall loaded into a state, and the wall's other openings. */
function openingContext(project: Project, asm: Assembly, tool: string): { ctx: OpeningContext } | { error: CommandError } {
  const op = openingParamsOf(asm)!;
  const wall = wallParamsOf(project, op.wallId);
  if (!wall) {
    return {
      error: commandError('not_allowed', `${asm.id}'s wall ${op.wallId} wasn't made with build_wall, so ${tool} can't re-frame it.`, { path: 'openingId' }),
    };
  }
  const state = loadWallState(project, op.wallId, wall);
  const othersById = Object.values(project.assemblies).flatMap((a) => {
    const o = a.id === asm.id ? null : openingParamsOf(a);
    return o && o.wallId === op.wallId ? [{ id: a.id, o }] : [];
  });
  const others = othersById.map((x) => x.o);
  const existing = othersById.map(({ id, o }) => ({ label: id, framingU0: o.framingU0, framingU1: o.framingU1 }));
  const braces = state.items.filter((i) => i.role === 'brace').map((i) => i.box);
  return { ctx: { op, wall, state, others, existing, braces } };
}

const zOpeningId = z.string().trim().min(1).describe('The opening to change, e.g. "O1".');
const unchanged = (d: string) => `${d} Default: unchanged. ${LENGTH_DESCRIPTION}`;

const updateOpeningSchema = z.strictObject({
  openingId: zOpeningId,
  width: zOpeningFields.width.describe(unchanged('New rough-opening width. Keeps the opening centred unless you give "at" or "centerAt".')),
  height: zOpeningFields.height.describe(unchanged('New rough-opening height. A window keeps its sill unless you give "sillHeight".')),
  at: zOpeningFields.at.describe(unchanged(`New distance from the wall's start point to the near edge of the rough opening. Give "at" or "centerAt", not both.`)),
  centerAt: zOpeningFields.centerAt.describe(unchanged(`New distance from the wall's start point to the centre of the opening. Give "at" or "centerAt", not both.`)),
  sillHeight: zOpeningFields.sillHeight.describe(unchanged('Windows only: new height of the bottom of the rough opening above the subfloor.')),
});

function updateOpeningLayout(project: Project, input: z.output<typeof updateOpeningSchema>, ctx: CommandContext): LayoutResult {
  const found = findOpening(project, input.openingId, 'update_opening', 'openingId');
  if ('error' in found) return fail(found.error);
  const asm = found.asm;
  const c = openingContext(project, asm, 'update_opening');
  if ('error' in c) return fail(c.error);
  const { op, wall, state, others, existing, braces } = c.ctx;
  if ([input.width, input.height, input.at, input.centerAt, input.sillHeight].every((v) => v === undefined)) {
    return fail(commandError('invalid_input', 'Give at least one of width, height, at, centerAt or sillHeight.', { path: 'openingId' }));
  }
  const width = input.width ?? op.width;
  const positioned = input.at !== undefined || input.centerAt !== undefined;
  const opening: OpeningInput = {
    kind: op.kind,
    width,
    height: input.height ?? op.height,
    ...(input.at !== undefined ? { at: input.at } : {}),
    ...(input.centerAt !== undefined ? { centerAt: input.centerAt } : {}),
    // A new width keeps the centre where it was.
    ...(!positioned ? { centerAt: op.at + op.width / 2 } : {}),
    // A window keeps its sill unless told otherwise; a door refuses sillHeight in resolveOpening.
    ...(input.sillHeight !== undefined ? { sillHeight: input.sillHeight } : op.kind === 'window' ? { sillHeight: op.roBottom } : {}),
    ...(op.product !== undefined ? { product: op.product } : {}),
    ...(op.safetyGlazing !== undefined ? { safetyGlazing: op.safetyGlazing } : {}),
  };
  const r = resolveOpening(wall, opening, existing, braces, (id) => sectionDims(ctx.catalog, id).depth);
  if (!r.ok) return fail(...r.errors);
  const o = r.opening;

  const panels = Object.values(project.parts).filter((x) => x.assemblyId === asm.id && x.role === 'panel').map((x) => x.id);
  unframeOpening(state, asm.id, op, others, panels);
  const unit = o.product ?? openingUnitMaterial(ctx.catalog);
  frameOpening(state, o, asm.id, unit ? { materialId: unit, seq: asm.buildStep?.seq ?? project.parts[panels[0] ?? ""]?.buildStep.seq ?? 0 } : undefined);
  keepUnchangedParts(state, project);
  const { joints, removedJoints } = openingJoints(project, state, op.wallId);

  const isCommon = (tags: readonly string[], role: string) => role === 'stud' && tags.includes('common');
  const putBack = state.items.filter((i) => i.isNew && isCommon(i.tags, i.role)).length;
  const removedCommons = state.removed.filter((id) => {
    const part = project.parts[id];
    return part !== undefined && isCommon(part.tags, part.role);
  }).length;
  const was: string[] = [];
  if (Math.abs(o.width - op.width) > 0.5) was.push(`${fi(op.width)} wide`);
  if (Math.abs(o.height - op.height) > 0.5) was.push(`${fi(op.height)} tall`);
  if (op.kind === 'window' && Math.abs(o.roBottom - op.roBottom) > 0.5) was.push(`sill at ${fi(op.roBottom)}`);
  if (Math.abs(o.roU0 - op.at) > 0.5) was.push(`${fi(op.at)} from the start`);
  const oldHeader = headerName(op.header);
  const headerChange = oldHeader !== o.header.name ? `; header ${oldHeader} → ${o.header.name}` : '';
  const updated: Assembly = { ...asm, builder: { name: OPENING_BUILDER, params: openingParams(o, op.wallId) as unknown as Record<string, unknown> } };
  return {
    ok: true,
    layout: {
      assemblies: [],
      updateAssemblies: [updated],
      parts: state.specs,
      joints,
      remove: { parts: state.removed, joints: removedJoints },
      notes: wall.loadBearing ? [`The header is sized for ${wall.snowNote} and ${wall.buildingWidthNote}.`] : [],
      what: "The opening's framing",
      summary: () =>
        `Re-framed ${asm.id} in ${op.wallId}: now a ${describeOpening(o)}, ${fi(o.roU0)} from the wall's start` +
        (was.length > 0 || headerChange ? ` (was ${was.length > 0 ? was.join(', ') : 'the same size'}${headerChange})` : '') +
        `; put back ${putBack} common stud${putBack === 1 ? '' : 's'}, removed ${removedCommons}.`,
    },
  };
}

export const updateOpening = builderCommand({
  name: 'update_opening',
  description:
    'Change an opening made by add_opening or build_wall without rebuilding its wall: new width, height, position ("at"/"centerAt", measured along the wall from its start) or window sill height. Re-frames only that opening (kings, jacks, a header re-sized from IRC Table R602.7(1), cripples, sill, the bottom-plate cut, the sheathing cut-out), puts back common studs where the old opening was and removes the ones now in the way. The wall, the opening ID and every other part keep their IDs. A new width keeps the opening centred unless you give a position; a new window height keeps the sill unless you give sillHeight. Kind and product stay; to change them, remove the opening and add a new one.',
  schema: updateOpeningSchema,
  layout: updateOpeningLayout,
});

const removeOpeningSchema = z.strictObject({ openingId: zOpeningId.describe('The opening to remove, e.g. "O1".') });

function removeOpeningLayout(project: Project, input: z.output<typeof removeOpeningSchema>): LayoutResult {
  const found = findOpening(project, input.openingId, 'remove_opening', 'openingId');
  if ('error' in found) return fail(found.error);
  const asm = found.asm;
  const c = openingContext(project, asm, 'remove_opening');
  if ('error' in c) return fail(c.error);
  const { op, state, others } = c.ctx;
  // Everything in the O assembly goes with it (the unit, and anything added to it since).
  const own = Object.values(project.parts).filter((x) => x.assemblyId === asm.id).map((x) => x.id);
  const back = unframeOpening(state, asm.id, op, others, own);
  keepUnchangedParts(state, project);
  const { joints, removedJoints } = openingJoints(project, state, op.wallId);
  const restored = [
    `${back.commons} common stud${back.commons === 1 ? '' : 's'}`,
    ...(back.plate ? ['the bottom plate'] : []),
    ...(back.sheathing > 0 ? ['the sheathing'] : []),
  ];
  const list = restored.length > 1 ? `${restored.slice(0, -1).join(', ')} and ${restored.at(-1)!}` : restored[0]!;
  return {
    ok: true,
    layout: {
      assemblies: [],
      parts: state.specs,
      joints,
      remove: { parts: state.removed, joints: removedJoints, assemblies: [asm.id] },
      notes: [],
      what: 'The restored wall framing',
      summary: () => `Removed ${asm.id} (${fi(op.width)} × ${fi(op.height)} ${op.kind}) from ${op.wallId}: put back ${list}.`,
    },
  };
}

export const removeOpening = builderCommand({
  name: 'remove_opening',
  description:
    'Remove an opening made by add_opening or build_wall: takes out its framing, unit and O assembly, and puts back the common studs, the continuous bottom plate and the sheathing. The wall and its other parts keep their IDs.',
  schema: removeOpeningSchema,
  layout: removeOpeningLayout,
});

export const builderCommands = [pourSlab, buildWall, addOpening, updateOpening, removeOpening, resizeHeader, frameFloor, buildRoof, buildFence, buildPergola, buildDeck, placeStructure];
