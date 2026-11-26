/**
 * Builder tools (ADR-0002 §A4): Claude says what to build; these lay out every stud,
 * header, joist, fastener and joint deterministically. Each builder is one command
 * and one history entry. Its redo is the resulting entity patch (`patch_entities`),
 * so redo after undo recreates exactly the same IDs.
 */
import { z } from 'zod';
import { checkCatalogRefs, emit, fail, type Layout, type LayoutResult } from '../builders/emit.ts';
import { contactJoints } from '../builders/contact.ts';
import { zBuilderMaterials } from '../builders/defaults.ts';
import { SPACINGS } from '../builders/rules.ts';
import { builderSeq, fi, sectionDims, zBuilderName, zPlanPoint } from '../builders/util.ts';
import { layoutFence } from '../builders/layout/fence.ts';
import { layoutFloor } from '../builders/layout/floor.ts';
import { bottomPlates, frameOpening, resolveOpening, zOpeningFields, zOpeningItem, type ResolvedOpening } from '../builders/layout/opening.ts';
import { layoutRoof } from '../builders/layout/roof.ts';
import { layoutSlab } from '../builders/layout/slab.ts';
import { STRUCTURE_KINDS, layoutStructure } from '../builders/layout/structure.ts';
import { layoutWall, neighbourMembers, openingUnitMaterial, openingsIn, resolveWall, supportJoints } from '../builders/layout/wall.ts';
import { OPENING_BUILDER, WALL_BUILDER, loadWallState, wallParamsOf, type WallParams } from '../builders/layout/wall-state.ts';
import { describeClashes, findClashes } from '../model/clash.ts';
import { jointsForParts } from '../model/queries.ts';
import type { Project } from '../model/schema.ts';
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
    layout.parts.map((p) => ({ id: p.key, position: p.position, rotation: p.rotation, size: p.size })),
    { ignore, ...(layout.clashSkip ? { skip: (c, e) => layout.clashSkip!(byKey.get(c.id)!, e) } : {}) },
  );
  return clashes.length > 0 ? [describeClashes(project, clashes, layout.what)] : [];
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
      const res = def.layout(project, input, ctx);
      return res.ok ? validateLayout(project, res.layout, ctx) : res.errors;
    },
    apply(project, input, ctx) {
      const res = def.layout(project, input, ctx);
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
  layout: (project, input, ctx) => layoutSlab(project, input, ctx.catalog),
});

// ── build_wall ──────────────────────────────────────────────────────────────

const WALL_CONVENTIONS =
  '"start" and "end" are plan points on the OUTSIDE face of the framing. The exterior is on the LEFT walking from start to end in a north-up plan, so list walls clockwise (or set "exterior"). "height" is the overall framed height, bottom of the bottom plate to the top of the double top plate: "9ft" gives 103 1/2in studs. The wall stands on the highest slab or floor under it (or on the ground). If an end lands on the end of an existing wall\'s outside face, it butts into that wall as a California corner (framing shortened, sheathing lapped, a backer stud added).';

function wallLayout(project: Project, input: z.output<typeof buildWallSchema>, ctx: CommandContext): LayoutResult {
  const r = resolveWall(project, input, ctx.catalog);
  if (!r.ok) return fail(...r.errors);
  const openings = input.openings ?? [];
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
      params: {
        wallId: id(wallRef),
        kind: o.kind,
        at: o.roU0,
        width: o.width,
        height: o.height,
        sillHeight: o.kind === 'window' ? o.roBottom : null,
        roBottom: o.roBottom,
        roTop: o.roTop,
        framingU0: o.framingU0,
        framingU1: o.framingU1,
        header: { plies: o.header.plies, sectionId: o.header.sectionId, flat: o.header.flat, length: o.header.length },
        jacks: o.jacks,
        kings: o.kings,
        headerRule: o.headerNote,
      },
    }),
  };
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
  const r = resolveOpening(params, input, openingsIn(project, input.wallId), braces, (id) => sectionDims(ctx.catalog, id).depth);
  if (!r.ok) return fail(...r.errors);
  const unit = openingUnitMaterial(ctx.catalog);
  const seq = builderSeq(project, OPENING_BUILDER);
  frameOpening(state, r.opening, '#o', unit ? { materialId: unit, seq } : undefined);

  const fresh = state.items.filter((i) => i.isNew);
  const kept = state.items.filter((i) => !i.isNew && i.role !== 'brace');
  const partners = new Set<string>([params.butt.start, params.butt.end].filter((x): x is string => x !== null));
  for (const asm of Object.values(project.assemblies)) {
    const p = asm.builder?.name === WALL_BUILDER ? (asm.builder.params as unknown as WallParams) : null;
    if (p && (p.butt.start === input.wallId || p.butt.end === input.wallId)) partners.add(asm.id);
  }
  const joints = contactJoints(state.frame, fresh, [...kept, ...neighbourMembers(project, state.frame, [...partners])]);
  const specMap = new Map(state.specs.map((s) => [s.key, s]));
  joints.push(...supportJoints(project, state, bottomPlates(state).filter((p) => p.isNew), specMap));
  const removedJoints = jointsForParts(project, state.removed).map((j) => j.id);

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
  layout: (project, input, ctx) => layoutFloor(project, input, ctx.catalog),
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

export const buildFence = builderCommand({
  name: 'build_fence',
  description:
    'Build a wood fence along a path: pressure-treated 4x4 posts set in concrete at every corner and at most 8ft apart, 2x4 rails (3 rails over 5ft tall), and 1x6 privacy boards or 1x4 pickets.',
  schema: z.strictObject({
    path: z.array(zPlanPoint).min(2).describe('Fence line: two or more plan points; a post goes at each.'),
    height: zPositiveLength.optional().describe(`Fence height above grade, 3ft to 8ft. Default 6ft. ${LENGTH_DESCRIPTION}`),
    style: z.enum(['privacy', 'picket']).optional().describe('privacy (tight 1x6 boards, default) or picket (1x4 pickets with 3 1/2in gaps).'),
    postSpacing: zPositiveLength.optional().describe(`Maximum post spacing, up to 8ft. Default 8ft. ${LENGTH_DESCRIPTION}`),
    materials,
    name: zBuilderName,
  }),
  layout: (project, input, ctx) => layoutFence(project, input, ctx.catalog),
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

export const builderCommands = [pourSlab, buildWall, addOpening, frameFloor, buildRoof, buildFence, placeStructure];
