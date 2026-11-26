/**
 * Framing an opening in a wall: header (sized from IRC Table R602.7(1)), jack and king
 * studs, cripples, a window sill, the bottom plate cut out for doors, and sheathing
 * cut around the rough opening. Shared by build_wall (inline openings) and add_opening.
 */
import { z } from 'zod';
import type { FrameBox } from '../../geometry/frame.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { MM_PER_INCH } from '../../units/length.ts';
import { zPositiveLength, zLength, LENGTH_DESCRIPTION } from '../../units/zod.ts';
import { BUILDER_DEFAULTS } from '../defaults.ts';
import {
  NONBEARING_FLAT_HEADER_MAX_SPAN_MM,
  kingStudsFor,
  largestHeader,
  pickHeader,
} from '../rules.ts';
import { compass, fi } from '../util.ts';
import type { Assembly } from '../../model/schema.ts';
import { OPENING_BUILDER, addMember, hasTag, removeItem, studTop, type WallItem, type WallParams, type WallState } from './wall-state.ts';

const IN = MM_PER_INCH;
const T = BUILDER_DEFAULTS.twoBy;
const GAP = 0.75 * IN;

export const OPENING_KINDS = ['window', 'door', 'sliding-door'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

export const OPENING_PRESETS: Record<OpeningKind, { width: number; height: number }> = {
  window: { width: 36 * IN, height: 48 * IN },
  door: { width: 38 * IN, height: 82.5 * IN },
  'sliding-door': { width: 72 * IN, height: 80.5 * IN },
};

export const zOpeningFields = {
  kind: z
    .enum(OPENING_KINDS)
    .describe('window, door or sliding-door. Sets the default rough-opening size (window 36x48in, door 38x82 1/2in, sliding door 72x80 1/2in).'),
  at: zLength
    .optional()
    .describe(`Distance from the wall's start point to the near edge of the rough opening. Give "at" or "centerAt". ${LENGTH_DESCRIPTION}`),
  centerAt: zLength
    .optional()
    .describe(`Distance from the wall's start point to the centre of the opening. Give "at" or "centerAt". ${LENGTH_DESCRIPTION}`),
  width: zPositiveLength.optional().describe(`Rough-opening width. Defaults to the kind's preset. ${LENGTH_DESCRIPTION}`),
  height: zPositiveLength.optional().describe(`Rough-opening height. Defaults to the kind's preset. ${LENGTH_DESCRIPTION}`),
  sillHeight: zLength
    .optional()
    .describe(
      `Windows only: height of the bottom of the rough opening above the subfloor. Default puts the top of the window at 82 1/2in, level with a door head. ${LENGTH_DESCRIPTION}`,
    ),
  product: z
    .string()
    .min(1)
    .optional()
    .describe('A specific window or door from the catalog (category opening, e.g. "window-casement" or "door-french"). Default: a generic unit, unpriced until you pick one.'),
  safetyGlazing: z
    .boolean()
    .optional()
    .describe('Mark the unit as tempered or laminated safety glazing (needed near a pool, in and beside doors, near tubs). Default false.'),
};
export const zOpeningItem = z.strictObject(zOpeningFields).describe('An opening to frame in this wall.');
export type OpeningInput = z.output<typeof zOpeningItem>;

export interface ResolvedOpening {
  kind: OpeningKind;
  roU0: number;
  roU1: number;
  roBottom: number;
  roTop: number;
  width: number;
  height: number;
  header: { plies: number; sectionId: string; flat: boolean; depth: number; length: number; name: string };
  jacks: number;
  kings: number;
  framingU0: number;
  framingU1: number;
  /** Why this header: the table column used. */
  headerNote: string;
  /** A specific catalog unit, when given. */
  product?: string;
  /** Asked for tempered or laminated glazing. */
  safetyGlazing?: boolean;
}

/** The recipe add_opening (and build_wall's inline openings) store on an opening assembly. */
export interface OpeningParams {
  wallId: string;
  kind: OpeningKind;
  /** Near edge of the rough opening, from the wall's start. */
  at: number;
  width: number;
  height: number;
  sillHeight: number | null;
  roBottom: number;
  roTop: number;
  framingU0: number;
  framingU1: number;
  header: { plies: number; sectionId: string; flat: boolean; length: number };
  jacks: number;
  kings: number;
  headerRule: string;
  product?: string;
  safetyGlazing?: boolean;
}

/** An opening assembly's stored recipe, or null if add_opening didn't make it. */
export function openingParamsOf(asm: Assembly | undefined): OpeningParams | null {
  if (!asm || asm.builder?.name !== OPENING_BUILDER) return null;
  return asm.builder.params as unknown as OpeningParams;
}

/** The recipe to store for a resolved opening, in the same shape everywhere. */
export function openingParams(o: ResolvedOpening, wallId: string): OpeningParams {
  return {
    wallId,
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
    // Only when given, so recipes made before these fields existed stay the same.
    ...(o.product !== undefined ? { product: o.product } : {}),
    ...(o.safetyGlazing !== undefined ? { safetyGlazing: o.safetyGlazing } : {}),
  };
}

/** A framed opening already in the wall (from its O assembly) or earlier in the same build. */
export interface ExistingOpening {
  label: string;
  framingU0: number;
  framingU1: number;
}

export function headerName(h: { plies: number; sectionId: string; flat: boolean }): string {
  return h.flat ? `flat ${h.sectionId}` : `${h.plies}-${h.sectionId}`;
}

/**
 * Work out where everything goes, or say why it can't be framed. `path` prefixes
 * error paths (e.g. "openings[1]." for inline openings).
 */
export function resolveOpening(
  wall: WallParams,
  input: OpeningInput,
  existing: readonly ExistingOpening[],
  braces: readonly FrameBox[],
  sectionDepth: (id: string) => number,
  path = '',
): { ok: true; opening: ResolvedOpening } | { ok: false; errors: CommandError[] } {
  const err = (msg: string, field?: string, hint?: string) => ({
    ok: false as const,
    errors: [
      commandError('invalid_input', msg, {
        ...(field !== undefined ? { path: `${path}${field}` } : {}),
        ...(hint !== undefined ? { hint } : {}),
      }),
    ],
  });
  const preset = OPENING_PRESETS[input.kind];
  const width = input.width ?? preset.width;
  const height = input.height ?? preset.height;
  const isDoor = input.kind !== 'window';

  if ((input.at === undefined) === (input.centerAt === undefined)) {
    return err('Give exactly one of "at" (distance to the near edge) or "centerAt" (distance to the centre).', 'at');
  }
  if (isDoor && input.sillHeight !== undefined) {
    return err('Doors start at the floor, so "sillHeight" only applies to windows.', 'sillHeight');
  }
  const roU0 = input.at ?? input.centerAt! - width / 2;
  const roU1 = roU0 + width;
  const roBottom = isDoor ? 0 : (input.sillHeight ?? BUILDER_DEFAULTS.headHeight - height);
  const roTop = roBottom + height;
  if (!isDoor) {
    if (roBottom <= 0) {
      return err(`A window sill at ${fi(roBottom)} is at or below the floor; use a door, or raise "sillHeight".`, 'sillHeight');
    }
    if (roBottom < 2 * T) {
      return err(
        `A window sill at ${fi(roBottom)} leaves no room for the sill plate over the bottom plate; it needs to be at least ${fi(2 * T)}.`,
        'sillHeight',
      );
    }
  }

  // Header.
  let header: ResolvedOpening['header'];
  let jacks: number;
  let headerNote: string;
  if (wall.loadBearing) {
    const maxPlies = Math.floor((wall.depth + 0.5) / T);
    const q = { snowPsf: wall.snowPsf, buildingWidthFt: wall.buildingWidthFt, maxPlies };
    const choice = pickHeader({ ...q, spanMm: width });
    if (!choice) {
      if (wall.snowPsf > 70) {
        return err(
          `The ground snow load (${Number(wall.snowPsf.toFixed(1))} psf) is beyond the prescriptive header table (70 psf max); this needs an engineered header.`,
          'width',
        );
      }
      if (wall.buildingWidthFt > 36) {
        return err(
          `A ${Number(wall.buildingWidthFt.toFixed(1))}ft-wide building is beyond the prescriptive header table (36ft max); this needs an engineered header.`,
          'width',
        );
      }
      const big = largestHeader(q);
      const max = big ? ` (${headerName({ ...big, flat: false })} max ${fi(big.maxSpanMm)} at ${big.snowPsf} psf)` : '';
      return err(
        `A ${fi(width)} opening is longer than any built-up 2x header allows here${max}. Use a narrower opening or an engineered beam.`,
        'width',
      );
    }
    header = {
      plies: choice.plies,
      sectionId: choice.sectionId,
      flat: false,
      depth: sectionDepth(choice.sectionId),
      length: 0,
      name: '',
    };
    jacks = choice.jacks;
    headerNote = `IRC Table R602.7(1): ${choice.snowPsf} psf, ${choice.buildingWidthFt}ft building width column`;
  } else {
    if (width > NONBEARING_FLAT_HEADER_MAX_SPAN_MM + 1e-6) {
      return err(
        `In a non-bearing wall a flat 2x4 header spans at most ${fi(NONBEARING_FLAT_HEADER_MAX_SPAN_MM)} (IRC R602.7.4); this opening is ${fi(width)}.`,
        'width',
        'Use a narrower opening, or make the wall load-bearing so a built-up header is sized.',
      );
    }
    header = { plies: 1, sectionId: '2x4', flat: true, depth: T, length: 0, name: '' };
    jacks = 1;
    headerNote = 'IRC R602.7.4: flat 2x4 header in a non-bearing wall';
  }
  header.name = headerName(header);
  header.length = width + 2 * jacks * T;

  const kings = wall.loadBearing ? kingStudsFor(width) : 1;
  if (kings === null) {
    return err(`A ${fi(width)} opening is wider than the king-stud table covers (18ft); this needs engineering.`, 'width');
  }

  const top = studTop(wall, T);
  if (roTop + header.depth > top + 1e-6) {
    const max = top - header.depth - roBottom;
    const what = isDoor ? 'door' : 'window';
    const where = isDoor ? '' : ` at a ${fi(roBottom)} sill height`;
    return err(
      `A ${fi(wall.height)} wall fits a ${what} at most ${fi(max)} tall${where} with a ${header.name} header; you asked for ${fi(height)}.`,
      'height',
    );
  }

  const framingU0 = roU0 - (jacks + kings) * T;
  const framingU1 = roU1 + (jacks + kings) * T;
  const dir = { x: wall.end.x - wall.start.x, z: wall.end.z - wall.start.z };
  const startRoom = wall.frameU0 + T;
  const endRoom = wall.frameU1 - T;
  if (framingU0 < startRoom - 1e-6) {
    return err(
      `The opening needs ${fi(startRoom - framingU0)} more room at the ${compass(-dir.x, -dir.z)} end for the king and jack studs.`,
      input.at !== undefined ? 'at' : 'centerAt',
      `Move it at least ${fi(startRoom - framingU0)} further from the wall's start.`,
    );
  }
  if (framingU1 > endRoom + 1e-6) {
    return err(
      `The opening needs ${fi(framingU1 - endRoom)} more room at the ${compass(dir.x, dir.z)} end for the king and jack studs.`,
      input.at !== undefined ? 'at' : 'centerAt',
      `Move it at least ${fi(framingU1 - endRoom)} towards the wall's start, or make it narrower.`,
    );
  }
  for (const o of existing) {
    if (framingU0 < o.framingU1 - 1e-6 && o.framingU0 < framingU1 - 1e-6) {
      return err(`The opening's framing would overlap ${o.label}'s framing.`, input.at !== undefined ? 'at' : 'centerAt', 'Move it along the wall.');
    }
  }
  for (const b of braces) {
    if (framingU0 < b.u1 && b.u0 < framingU1) {
      return err(
        'The opening would cut through a let-in brace. Move it away from the wall end, or build the wall with bracing: "sheathing".',
        input.at !== undefined ? 'at' : 'centerAt',
      );
    }
  }

  return {
    ok: true,
    opening: {
      kind: input.kind,
      roU0,
      roU1,
      roBottom,
      roTop,
      width,
      height,
      header,
      jacks,
      kings,
      framingU0,
      framingU1,
      headerNote,
      ...(input.product !== undefined ? { product: input.product } : {}),
      ...(input.safetyGlazing !== undefined ? { safetyGlazing: input.safetyGlazing } : {}),
    },
  };
}

/** Layout marks (stud centres at n × spacing from the wall start) whose stud fits in [a, b]. */
function marksWithin(spacing: number, a: number, b: number): number[] {
  const out: number[] = [];
  for (let n = Math.max(1, Math.ceil((a + T / 2) / spacing - 1e-9)); n * spacing + T / 2 <= b + 1e-6; n++) {
    out.push(n * spacing);
  }
  return out.length > 0 || b - a < T ? out : [(a + b) / 2];
}

/** Rectangles of `r` left after cutting out `hole` (all in u/v). */
export function cutRect(r: FrameBox, hole: { u0: number; u1: number; v0: number; v1: number }): FrameBox[] {
  const ou0 = Math.max(r.u0, hole.u0);
  const ou1 = Math.min(r.u1, hole.u1);
  const ov0 = Math.max(r.v0, hole.v0);
  const ov1 = Math.min(r.v1, hole.v1);
  if (ou1 - ou0 <= 1 || ov1 - ov0 <= 1) return [r];
  const pieces: FrameBox[] = [
    { ...r, u1: ou0 },
    { ...r, u0: ou1 },
    { ...r, u0: ou0, u1: ou1, v1: ov0 },
    { ...r, u0: ou0, u1: ou1, v0: ov1 },
  ];
  return pieces.filter((p) => p.u1 - p.u0 > 1 && p.v1 - p.v0 > 1);
}

/** The header and opening framing in `o` only needs these fields. */
export type HeaderFraming = Pick<ResolvedOpening, 'roU0' | 'roU1' | 'roTop' | 'jacks' | 'header'>;

/** Adds a member tagged `opening:<ref>`, in the wall's lumber. */
function openingMember(state: WallState, o: HeaderFraming, openingRef: string) {
  const tag = `opening:${openingRef}`;
  const lumber = state.params.materials.lumber;
  return (role: 'stud' | 'header' | 'sill' | 'plate', tags: string[], box: FrameBox, vertical: boolean, sectionId: string) =>
    addMember(state, {
      role,
      tags: [...tags, tag],
      box,
      lengthAxis: vertical ? 'v' : 'u',
      widthAxis: vertical ? 'u' : role === 'header' && !o.header.flat ? 'w' : 'v',
      materialId: lumber,
      sectionId,
      phase: 'framing',
    });
}

/**
 * The header over an opening (plies on edge side by side from the outside face, or
 * one flat 2x4) and the cripples above it on layout, up to the top plate. Shared by
 * `frameOpening` and `resize_header`.
 */
export function frameHeader(state: WallState, o: HeaderFraming, openingRef: string): void {
  const p = state.params;
  const top = studTop(p, T);
  const D = p.depth;
  const frameMember = openingMember(state, o, openingRef);
  const jL0 = o.roU0 - o.jacks * T;
  const jR1 = o.roU1 + o.jacks * T;
  if (o.header.flat) {
    frameMember('header', ['header'], { u0: jL0, u1: jR1, v0: o.roTop, v1: o.roTop + T, w0: 0, w1: 3.5 * IN }, false, o.header.sectionId);
  } else {
    for (let i = 0; i < o.header.plies; i++) {
      frameMember(
        'header',
        ['header'],
        { u0: jL0, u1: jR1, v0: o.roTop, v1: o.roTop + o.header.depth, w0: i * T, w1: (i + 1) * T },
        false,
        o.header.sectionId,
      );
    }
  }
  const headerTop = o.roTop + headerHeight(o.header);
  if (top - headerTop > 1) {
    for (const c of marksWithin(p.spacing, jL0, jR1)) {
      frameMember('stud', ['cripple'], { u0: c - T / 2, u1: c + T / 2, v0: headerTop, v1: top, w0: 0, w1: D }, true, p.studSectionId);
    }
  }
}

/** How tall a header stands in the wall: its depth on edge, or 1 1/2in flat. */
export const headerHeight = (h: { flat: boolean; depth: number }) => (h.flat ? T : h.depth);

/** A header size as people write it: "2-2x10", "3-2x12", "flat 2x4". Null if it isn't one. */
export function parseHeaderSize(text: string): { plies: number; sectionId: string; flat: boolean } | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const flat = /^flat (2x\d+)$/.exec(s);
  if (flat) return { plies: 1, sectionId: flat[1]!, flat: true };
  const m = /^(?:(\d)\s*[-x×]\s*|(\d) ?ply )?(2x\d+)$/.exec(s);
  if (!m) return null;
  const plies = Number(m[1] ?? m[2] ?? 1);
  if (plies < 1) return null;
  return { plies, sectionId: m[3]!, flat: false };
}

/**
 * Frame the opening into the wall state: remove the common studs in its way, add
 * kings, jacks, header, cripples and sill, cut the bottom plate for doors and cut the
 * sheathing around the rough opening. New framing is tagged `opening:<ref>`.
 */
export function frameOpening(state: WallState, o: ResolvedOpening, openingRef: string, panel?: { materialId: string; seq: number }): void {
  const p = state.params;
  const top = studTop(p, T);
  const D = p.depth;
  const frameMember = openingMember(state, o, openingRef);

  // Common studs in the way.
  for (const item of [...state.items]) {
    if (item.role === 'stud' && hasTag(item, 'common') && item.box.u1 > o.framingU0 - GAP && item.box.u0 < o.framingU1 + GAP) {
      removeItem(state, item);
    }
  }

  const studBox = (u0: number, v0: number, v1: number): FrameBox => ({ u0, u1: u0 + T, v0, v1, w0: 0, w1: D });
  const jL0 = o.roU0 - o.jacks * T;
  const jR1 = o.roU1 + o.jacks * T;

  // King studs, outermost first on each side.
  for (let i = 0; i < o.kings; i++) frameMember('stud', ['king'], studBox(o.framingU0 + i * T, T, top), true, p.studSectionId);
  for (let i = o.kings - 1; i >= 0; i--) frameMember('stud', ['king'], studBox(jR1 + (o.kings - 1 - i) * T, T, top), true, p.studSectionId);
  // Jack studs under the header ends.
  for (let i = 0; i < o.jacks; i++) frameMember('stud', ['jack'], studBox(jL0 + i * T, T, o.roTop), true, p.studSectionId);
  for (let i = 0; i < o.jacks; i++) frameMember('stud', ['jack'], studBox(o.roU1 + i * T, T, o.roTop), true, p.studSectionId);

  frameHeader(state, o, openingRef);

  if (o.kind === 'window') {
    // Flat sill between the jacks, and cripples under it on layout.
    frameMember('sill', ['sill'], { u0: o.roU0, u1: o.roU1, v0: o.roBottom - T, v1: o.roBottom, w0: 0, w1: D }, false, p.studSectionId);
    if (o.roBottom - T - T > 1) {
      for (const c of marksWithin(p.spacing, o.roU0, o.roU1)) {
        frameMember('stud', ['cripple'], studBox(c - T / 2, T, o.roBottom - T), true, p.studSectionId);
      }
    }
  } else {
    // Cut the bottom plate out between the jacks.
    for (const plate of state.items.filter((i) => i.role === 'plate' && hasTag(i, 'bottom'))) {
      if (plate.box.u1 <= o.roU0 + 1 || plate.box.u0 >= o.roU1 - 1) continue;
      removeItem(state, plate);
      for (const [u0, u1] of [
        [plate.box.u0, o.roU0],
        [o.roU1, plate.box.u1],
      ] as const) {
        if (u1 - u0 <= 1) continue;
        addMember(state, {
          role: 'plate',
          tags: plate.tags.filter((t) => !t.startsWith('opening:')),
          box: { ...plate.box, u0, u1 },
          lengthAxis: 'u',
          widthAxis: 'v',
          materialId: plate.materialId,
          sectionId: p.studSectionId,
          phase: 'framing',
        });
      }
    }
  }

  // The door or window unit itself, in the opening's assembly, when the catalog has one.
  if (panel) {
    addMember(state, {
      role: 'panel',
      tags: [o.kind, `opening:${openingRef}`, ...(o.safetyGlazing ? ['safety-glazing'] : [])],
      box: { u0: o.roU0, u1: o.roU1, v0: o.roBottom, v1: o.roTop, w0: 0, w1: D },
      lengthAxis: 'u',
      widthAxis: 'v',
      materialId: panel.materialId,
      phase: 'openings',
      assembly: openingRef,
      seq: panel.seq,
    });
  }

  // Cut the sheathing around the rough opening.
  const hole = { u0: o.roU0, u1: o.roU1, v0: o.roBottom, v1: o.roTop };
  for (const panel of state.items.filter((i) => i.role === 'sheathing')) {
    const pieces = cutRect(panel.box, hole);
    if (pieces.length === 1 && pieces[0] === panel.box) continue;
    removeItem(state, panel);
    for (const box of pieces) {
      addMember(state, {
        role: 'sheathing',
        tags: panel.tags,
        box,
        lengthAxis: 'u',
        widthAxis: 'v',
        materialId: panel.materialId,
        phase: 'sheathing',
      });
    }
  }
}

/** Bottom-plate items in a wall state. */
export const bottomPlates = (state: WallState): WallItem[] => state.items.filter((i) => i.role === 'plate' && hasTag(i, 'bottom'));
