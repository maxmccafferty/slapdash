/**
 * The window or door unit in a framed opening, laid out as real pieces in wall u/v/w:
 * a frame (head, jambs, and a sill or a door threshold), sashes built from stiles and
 * rails with glass lites in their daylight openings, door slabs or glazed leaves, and a
 * nailing fin or brickmould casing on the outside. Every piece is a part in the
 * product's material in the opening's O assembly; the takeoff still counts the unit once.
 *
 * The unit sits in the rough opening with a shim gap at the sides and head. It's nailed
 * to the framing just as the old single-box unit was (contact against the rough-opening
 * box, re-pointed to the frame piece on that side), and its own pieces are held together
 * by `factory-assembled` joints to its bottom frame piece, so it moves as one body.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import type { OpeningStyle, OpeningUnit } from '../../catalog/schema.ts';
import { toWorld, type FrameAxis, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import type { UnitPiece } from '../../model/opening-unit.ts';
import { MM_PER_INCH } from '../../units/length.ts';
import { contactJoints, type Member } from '../contact.ts';
import { BUILDER_DEFAULTS, DEFAULT_UNIT_SPECS, UNIT_SHIM } from '../defaults.ts';
import type { JointSpec, Ref } from '../emit.ts';
import type { OpeningKind } from './opening.ts';
import type { UnitRecord, WallItem, WallParams, WallState } from './wall-state.ts';

const IN = MM_PER_INCH;
/** No unit piece is drawn thinner than this; the unit simplifies instead. */
const MIN = 1 * IN;
const FIN_THICKNESS = 1.6;
const THRESHOLD = 1 * IN;
const CASING_REVEAL = (3 / 16) * IN;
const LEAF_GAP = (1 / 8) * IN;
const LEAF_FLOOR_GAP = 0.5 * IN;
const GLASS_THICKNESS = { igu: 19.05, single: 3.2, none: 0 } as const;
/** A glazed door leaf when the product gives no sash sizes. */
const DOOR_SASH: NonNullable<OpeningUnit['sash']> = { stile_mm: 4.5 * IN, topRail_mm: 4.5 * IN, bottomRail_mm: 9.5 * IN, depth_mm: 1.75 * IN };

export const KIND_STYLES: Record<OpeningKind, readonly OpeningStyle[]> = {
  window: ['fixed', 'casement', 'awning', 'single-hung', 'double-hung', 'slider'],
  door: ['entry', 'french'],
  'sliding-door': ['sliding', 'french'],
};

export type ResolvedUnitSpec = OpeningUnit & { style: OpeningStyle };

/**
 * How to draw `materialId`'s unit in a `kind` opening: the product's `unit`, else the
 * default for the kind. A unit with no style takes the kind's (a casement window, a flat
 * slab door, a sliding door). A style that doesn't fit the kind (a casement window in a
 * door opening) falls back to the kind's default, with a note saying so.
 */
export function resolveUnitSpec(materialId: string, kind: OpeningKind, catalog: CatalogIndex): { spec: ResolvedUnitSpec; note?: string } {
  const material = catalog.materials.get(materialId);
  const def = DEFAULT_UNIT_SPECS[kind] as ResolvedUnitSpec;
  const base = material?.unit ?? def;
  let spec: ResolvedUnitSpec;
  if (base.style === undefined) {
    if (kind === 'door') spec = { ...base, style: 'entry', lites: 0, slab: base.slab ?? def.slab! };
    else spec = { ...base, style: def.style, lites: Math.max(1, base.lites), sash: base.sash ?? def.sash!, glass: base.glass === 'none' ? 'igu' : base.glass };
  } else {
    spec = { ...base, style: base.style };
  }
  if (!KIND_STYLES[kind].includes(spec.style)) {
    const what = material?.name ?? materialId;
    return {
      spec: def,
      note: `${what} is a ${spec.style} unit, which doesn't fit a ${kind.replace('-', ' ')}, so it's drawn as a ${def.style} ${kind === 'window' ? 'window' : 'door'}.`,
    };
  }
  return { spec };
}

export interface UnitMember {
  role: 'frame' | 'sash' | 'glass' | 'door' | 'trim';
  piece: UnitPiece;
  /** Tags besides the opening's and the piece's: `sash:<n>`, hinge, swing and slide tags. */
  tags: string[];
  box: FrameBox;
  lengthAxis: FrameAxis;
  widthAxis: FrameAxis;
  /** Frame pieces the unit is nailed through: the side of the rough opening they face. */
  side?: 'start' | 'end' | 'head' | 'bottom';
}

/** The parts of a resolved opening the unit layout needs. */
export interface UnitOpening {
  kind: OpeningKind;
  roU0: number;
  roU1: number;
  roBottom: number;
  roTop: number;
}

interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const wide = (r: Rect) => r.u1 - r.u0;
const tall = (r: Rect) => r.v1 - r.v0;

/**
 * The unit's pieces for opening `o` in a wall with these params. Never refuses: a unit
 * too small for its sashes draws fewer of them, then glass or a slab straight in the
 * frame, then only the frame. The first member is the bottom frame piece (the anchor).
 */
export function layoutUnit(o: UnitOpening, spec: ResolvedUnitSpec, wall: Pick<WallParams, 'depth' | 'sheathingThickness'>): UnitMember[] {
  const out: UnitMember[] = [];
  const SH = wall.sheathingThickness;
  const isDoor = o.kind !== 'window';
  const casing = isDoor ? spec.casing : undefined;
  const flange = casing ? undefined : spec.flange;
  const U0 = o.roU0 + UNIT_SHIM.side;
  const U1 = o.roU1 - UNIT_SHIM.side;
  const V0 = o.roBottom;
  const V1 = o.roTop - UNIT_SHIM.head;
  const W0 = -SH - (flange?.setback_mm ?? 0);
  const W1 = wall.depth;
  if (U1 - U0 < 3 || V1 - V0 < 3) return out;
  const F = Math.min(spec.frame.face_mm, (U1 - U0) / 3, (V1 - V0) / 3);
  const S = Math.min(isDoor ? THRESHOLD : F, (V1 - V0) / 3);

  const add = (
    role: UnitMember['role'],
    piece: UnitPiece,
    box: FrameBox,
    lengthAxis: FrameAxis,
    widthAxis: FrameAxis,
    tags: string[] = [],
    side?: UnitMember['side'],
  ) => out.push({ role, piece, tags, box, lengthAxis, widthAxis, ...(side ? { side } : {}) });
  const at = (r: Rect, w0: number, w1: number): FrameBox => ({ ...r, w0, w1 });

  // Frame: the bottom piece first (everything else is held to it), then head and jambs.
  add('frame', isDoor ? 'threshold' : 'sill', at({ u0: U0, u1: U1, v0: V0, v1: V0 + S }, W0, W1), 'u', 'v', [], 'bottom');
  add('frame', 'head', at({ u0: U0, u1: U1, v0: V1 - F, v1: V1 }, W0, W1), 'u', 'v', [], 'head');
  add('frame', 'jamb', at({ u0: U0, u1: U0 + F, v0: V0 + S, v1: V1 - F }, W0, W1), 'v', 'u', [], 'start');
  add('frame', 'jamb', at({ u0: U1 - F, u1: U1, v0: V0 + S, v1: V1 - F }, W0, W1), 'v', 'u', [], 'end');

  // Nailing fin on the sheathing face, covering the shim gap; the legs sit between the
  // top and bottom fins. Doors have none along the floor.
  if (flange) {
    const fw = flange.width_mm;
    const f0 = -SH - FIN_THICKNESS;
    const f1 = -SH;
    add('frame', 'flange', at({ u0: U0 - fw, u1: U1 + fw, v0: V1, v1: V1 + fw }, f0, f1), 'u', 'v');
    if (!isDoor) add('frame', 'flange', at({ u0: U0 - fw, u1: U1 + fw, v0: V0 - fw, v1: V0 }, f0, f1), 'u', 'v');
    add('frame', 'flange', at({ u0: U0 - fw, u1: U0, v0: V0, v1: V1 }, f0, f1), 'v', 'u');
    add('frame', 'flange', at({ u0: U1, u1: U1 + fw, v0: V0, v1: V1 }, f0, f1), 'v', 'u');
  }

  // Brickmould round a door, on the sheathing face, set back a reveal from the jambs.
  if (casing) {
    const cw = casing.width_mm;
    const c0 = -SH - casing.thickness_mm;
    const c1 = -SH;
    const inStart = U0 + F - CASING_REVEAL;
    const inEnd = U1 - F + CASING_REVEAL;
    const inHead = V1 - F + CASING_REVEAL;
    add('trim', 'casing', at({ u0: inStart - cw, u1: inStart, v0: V0, v1: inHead }, c0, c1), 'v', 'u');
    add('trim', 'casing', at({ u0: inEnd, u1: inEnd + cw, v0: V0, v1: inHead }, c0, c1), 'v', 'u');
    add('trim', 'casing', at({ u0: inStart - cw, u1: inEnd + cw, v0: inHead, v1: inHead + cw }, c0, c1), 'u', 'v');
  }

  const I: Rect = { u0: U0 + F, u1: U1 - F, v0: V0 + S, v1: V1 - F };
  if (wide(I) < MIN || tall(I) < MIN) return out;

  const glassT = GLASS_THICKNESS[spec.glass];
  const glass = (r: Rect, w0: number, w1: number, tags: string[]) => {
    if (glassT === 0 || wide(r) < MIN || tall(r) < MIN) return;
    const t = Math.min(glassT, w1 - w0);
    const c = (w0 + w1) / 2;
    const vertical = tall(r) >= wide(r);
    add('glass', 'glass', at(r, c - t / 2, c + t / 2), vertical ? 'v' : 'u', vertical ? 'u' : 'v', tags);
  };
  type Rails = { stile: number; top: number; bottom: number; topPiece?: UnitPiece; bottomPiece?: UnitPiece };
  /** A sash (or glazed leaf) of stiles and rails over `r`, with `lites` glass lites; just glass if it won't fit. */
  const sash = (r: Rect, w0: number, w1: number, rails: Rails, lites: number, tags: string[]) => {
    const st = rails.stile;
    if (wide(r) - 2 * st < MIN || tall(r) - rails.top - rails.bottom < MIN) {
      glass(r, w0, w1, tags);
      return;
    }
    const z = (x: Rect) => at(x, w0, w1);
    add('sash', 'stile', z({ u0: r.u0, u1: r.u0 + st, v0: r.v0, v1: r.v1 }), 'v', 'u', tags);
    add('sash', 'stile', z({ u0: r.u1 - st, u1: r.u1, v0: r.v0, v1: r.v1 }), 'v', 'u', tags);
    add('sash', rails.bottomPiece ?? 'rail', z({ u0: r.u0 + st, u1: r.u1 - st, v0: r.v0, v1: r.v0 + rails.bottom }), 'u', 'v', tags);
    add('sash', rails.topPiece ?? 'rail', z({ u0: r.u0 + st, u1: r.u1 - st, v0: r.v1 - rails.top, v1: r.v1 }), 'u', 'v', tags);
    const day: Rect = { u0: r.u0 + st, u1: r.u1 - st, v0: r.v0 + rails.bottom, v1: r.v1 - rails.top };
    let n = Math.max(1, lites);
    if ((wide(day) - (n - 1) * st) / n < MIN) n = 1;
    const lw = (wide(day) - (n - 1) * st) / n;
    for (let i = 0; i < n; i++) {
      const u0 = day.u0 + i * (lw + st);
      if (i > 0) add('sash', 'mullion', z({ u0: u0 - st, u1: u0, v0: day.v0, v1: day.v1 }), 'v', 'u', tags);
      glass({ ...day, u0, u1: u0 + lw }, w0, w1, tags);
    }
  };

  // Sash tracks inside the frame's depth, from its outside face.
  const B0 = W0;
  const B1 = W0 + Math.min(spec.frame.depth_mm, W1 - W0);
  const sashSpec = spec.sash ?? (isDoor ? DOOR_SASH : DEFAULT_UNIT_SPECS['window'].sash!);
  const d = Math.min(sashSpec.depth_mm, B1 - B0);
  const centred = { w0: (B0 + B1) / 2 - d / 2, w1: (B0 + B1) / 2 + d / 2 };
  const twoTracks = 2 * sashSpec.depth_mm <= W1 - W0;
  const tracks = () => {
    const dd = sashSpec.depth_mm;
    let e0 = B0 + Math.max(0, (B1 - B0 - 2 * dd) / 2);
    if (e0 + 2 * dd > W1) e0 = W1 - 2 * dd;
    return { ext: { w0: e0, w1: e0 + dd }, int: { w0: e0 + dd, w1: e0 + 2 * dd } };
  };
  const rails: Rails = { stile: sashSpec.stile_mm, top: sashSpec.topRail_mm, bottom: sashSpec.bottomRail_mm };
  const oneSash = (tags: string[]) => sash(I, centred.w0, centred.w1, rails, spec.lites, tags);

  switch (spec.style) {
    case 'fixed':
    case 'casement':
    case 'awning':
      oneSash(['sash:0', spec.style === 'fixed' ? 'fixed' : 'operable']);
      break;
    case 'single-hung':
    case 'double-hung': {
      const mr = sashSpec.meetingRail_mm ?? sashSpec.topRail_mm;
      const h = (tall(I) + mr) / 2;
      if (!twoTracks || h - mr - Math.max(rails.top, rails.bottom) < MIN) {
        oneSash(['sash:0', 'operable']);
        break;
      }
      const t = tracks();
      sash({ ...I, v0: I.v1 - h }, t.ext.w0, t.ext.w1, { ...rails, bottom: mr, bottomPiece: 'meeting-rail' }, spec.lites, [
        'sash:0',
        spec.style === 'single-hung' ? 'fixed' : 'operable',
      ]);
      sash({ ...I, v1: I.v0 + h }, t.int.w0, t.int.w1, { ...rails, top: mr, topPiece: 'meeting-rail' }, spec.lites, ['sash:1', 'operable']);
      break;
    }
    case 'slider':
    case 'sliding': {
      const st = rails.stile;
      const wp = (wide(I) + st) / 2;
      if (!twoTracks || wp - 2 * st < MIN) {
        oneSash(['sash:0', 'fixed']);
        break;
      }
      const t = tracks();
      sash({ ...I, u1: I.u0 + wp }, t.int.w0, t.int.w1, rails, spec.lites, ['sash:0', 'operable', 'slides:toward-end']);
      sash({ ...I, u0: I.u1 - wp }, t.ext.w0, t.ext.w1, rails, spec.lites, ['sash:1', 'fixed']);
      break;
    }
    case 'entry':
    case 'french': {
      const L: Rect = { u0: I.u0 + LEAF_GAP, u1: I.u1 - LEAF_GAP, v0: I.v0 + LEAF_FLOOR_GAP, v1: I.v1 - LEAF_GAP };
      const solid = spec.style === 'entry' && spec.lites === 0;
      const leafRect = wide(L) >= MIN && tall(L) >= MIN ? L : I;
      let n = spec.style === 'french' ? 2 : (spec.leaves ?? 1);
      if (n === 2 && (wide(leafRect) - LEAF_GAP) / 2 < MIN) n = 1;
      const lw = n === 1 ? wide(leafRect) : (wide(leafRect) - LEAF_GAP) / 2;
      const thick = Math.min(solid ? (spec.slab?.thickness_mm ?? 1.75 * IN) : sashSpec.depth_mm, W1 - W0);
      const c = (W0 + W1) / 2;
      for (let i = 0; i < n; i++) {
        const u0 = leafRect.u0 + i * (lw + LEAF_GAP);
        const r = { ...leafRect, u0, u1: u0 + lw };
        const tags = [`sash:${i}`, i === 0 ? 'hinge:start' : 'hinge:end', 'swing:in'];
        if (solid) add('door', 'slab', at(r, c - thick / 2, c + thick / 2), 'v', 'u', tags);
        else sash(r, c - thick / 2, c + thick / 2, rails, Math.max(1, spec.lites), tags);
      }
      break;
    }
  }
  return out;
}

/** Fastener positions are rounded like contact joints'. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The joints that nail a unit's frame to the wall framing. Contact is worked out against
 * the rough-opening box (where the old single-box unit sat), so the joint types, nail
 * counts and positions are the ones it had; each joint is then moved to the frame piece
 * on that side: the start-side jack to the start jamb, header plies to the head, the
 * rough sill to the unit's sill. `target` picks the piece for a framing item (null skips it).
 */
export function attachmentJoints(
  frame: PlanFrame,
  ro: FrameBox,
  framing: readonly Member[],
  target: (item: Member, side: 'start' | 'end' | 'head' | 'bottom') => Ref | null,
): JointSpec[] {
  const roMember: Member = { ref: '#ro', role: 'panel', box: ro };
  const byRef = new Map(framing.map((m) => [m.ref, m]));
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.1;
  const out: JointSpec[] = [];
  for (const j of contactJoints(frame, [roMember], framing)) {
    const otherRef = j.a === '#ro' ? j.b : j.a;
    const item = byRef.get(otherRef);
    if (!item) continue;
    const b = item.box;
    const side = near(b.u1, ro.u0) ? 'start' : near(b.u0, ro.u1) ? 'end' : near(b.v0, ro.v1) ? 'head' : 'bottom';
    const ref = target(item, side);
    if (ref === null) continue;
    out.push({ ...j, a: ref, b: otherRef });
  }
  return out;
}

/**
 * A unit's joints in a framed wall state: attachment to the framing (see
 * `attachmentJoints`) and `factory-assembled` joints from each piece to the bottom
 * frame piece. Run after `keepUnchangedParts`; only joints with a new end are returned,
 * since joints between kept parts are already in the project.
 */
export function unitJoints(state: WallState, unit: UnitRecord): JointSpec[] {
  const units = new Set(unit.items);
  const all = new Set(state.units.flatMap((u) => u.items));
  const framing = state.items.filter((i) => !all.has(i) && i.role !== 'brace');
  const bySide = new Map(unit.sides);
  const out = attachmentJoints(state.frame, unit.ro, framing, (item, side) => {
    const piece = bySide.get(side) ?? unit.anchor;
    if (!piece) return null;
    return piece.isNew || (item as WallItem).isNew ? piece.ref : null;
  });
  const anchor = unit.anchor;
  if (anchor) {
    for (const item of units) {
      if (item === anchor || (!item.isNew && !anchor.isNew)) continue;
      const b = item.box;
      const p = toWorld(state.frame, { u: (b.u0 + b.u1) / 2, v: (b.v0 + b.v1) / 2, w: (b.w0 + b.w1) / 2 });
      out.push({
        a: item.ref,
        b: anchor.ref,
        jointTypeId: BUILDER_DEFAULTS.jointTypes.factoryAssembled,
        at: { x: round6(p.x), y: round6(p.y), z: round6(p.z) },
        fastenerCount: 1,
      });
    }
  }
  return out;
}
