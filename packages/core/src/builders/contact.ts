/**
 * Joints from contact. Framing members laid out as boxes in one frame get a joint
 * wherever two of them touch face to face: a stud standing on a plate, a jack nailed
 * to a king, a sheet on a stud. The fastener count follows the nailing schedule
 * (rules.ts).
 */
import { toWorld, type FrameBox, type PlanFrame } from '../geometry/frame.ts';
import type { PartRole } from '../model/ids.ts';
import { BUILDER_DEFAULTS } from './defaults.ts';
import type { JointSpec, Ref } from './emit.ts';
import { framingNailCount, sheathingNailCount } from './rules.ts';

export interface Member {
  ref: Ref;
  role: PartRole;
  box: FrameBox;
}

const TOUCH = 0.05; // mm
const MIN_OVERLAP = 1; // mm

type Axis = 'u' | 'v' | 'w';
const AXES: Axis[] = ['u', 'v', 'w'];
const lo = (b: FrameBox, a: Axis) => b[`${a}0`];
const hi = (b: FrameBox, a: Axis) => b[`${a}1`];

export interface Contact {
  /** Axis normal to the shared face. */
  normal: Axis;
  /** Overlap rectangle on the shared face, as a frame box (zero thickness along the normal). */
  face: FrameBox;
}

/** The shared face of two boxes that touch (and don't interpenetrate), or null. */
export function contactOf(a: FrameBox, b: FrameBox): Contact | null {
  let normal: Axis | null = null;
  let plane = 0;
  const face = {} as FrameBox;
  for (const ax of AXES) {
    const o0 = Math.max(lo(a, ax), lo(b, ax));
    const o1 = Math.min(hi(a, ax), hi(b, ax));
    if (o1 - o0 >= MIN_OVERLAP) {
      face[`${ax}0`] = o0;
      face[`${ax}1`] = o1;
      continue;
    }
    if (Math.abs(o1 - o0) <= TOUCH && normal === null) {
      normal = ax;
      plane = (o0 + o1) / 2;
      face[`${ax}0`] = plane;
      face[`${ax}1`] = plane;
      continue;
    }
    return null;
  }
  return normal ? { normal, face } : null;
}

const isSheet = (role: PartRole) => role === 'sheathing';

function faceCenter(face: FrameBox) {
  return { u: (face.u0 + face.u1) / 2, v: (face.v0 + face.v1) / 2, w: (face.w0 + face.w1) / 2 };
}

function longest(face: FrameBox, normal: Axis): number {
  return Math.max(...AXES.filter((a) => a !== normal).map((a) => hi(face, a) - lo(face, a)));
}

/**
 * Joints between `members` (new) and `members ∪ others` that touch. Sheets get 8d
 * nails to framing (6in on panel edges, 12in in the field); framing gets 16d nails.
 * Sheet-to-sheet contacts get nothing. Explicit pairs in `skip` are left alone.
 */
export function contactJoints(
  frame: PlanFrame,
  members: readonly Member[],
  others: readonly Member[] = [],
  opts: { skip?: (a: Member, b: Member) => boolean } = {},
): JointSpec[] {
  const out: JointSpec[] = [];
  const { nail16d, nail8d } = BUILDER_DEFAULTS.jointTypes;
  const consider = (a: Member, b: Member) => {
    if (isSheet(a.role) && isSheet(b.role)) return;
    if (opts.skip?.(a, b)) return;
    const c = contactOf(a.box, b.box);
    if (!c) return;
    const at = toWorld(frame, faceCenter(c.face));
    const r = (n: number) => Math.round(n * 1e6) / 1e6;
    const atClean = { x: r(at.x), y: r(at.y), z: r(at.z) };
    if (isSheet(a.role) || isSheet(b.role)) {
      const [sheet, framing] = isSheet(a.role) ? [a, b] : [b, a];
      // Nail line runs along the framing member's longest face dimension.
      const along = AXES.filter((x) => x !== c.normal).reduce((m, x) =>
        hi(c.face, x) - lo(c.face, x) > hi(c.face, m) - lo(c.face, m) ? x : m,
      );
      const across = AXES.find((x) => x !== c.normal && x !== along)!;
      const edge =
        lo(framing.box, across) <= lo(sheet.box, across) + 1 || hi(framing.box, across) >= hi(sheet.box, across) - 1;
      const len = hi(c.face, along) - lo(c.face, along);
      out.push({ a: sheet.ref, b: framing.ref, jointTypeId: nail8d, at: atClean, fastenerCount: sheathingNailCount(len, edge) });
      return;
    }
    out.push({ a: a.ref, b: b.ref, jointTypeId: nail16d, at: atClean, fastenerCount: framingNailCount(longest(c.face, c.normal)) });
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) consider(members[i]!, members[j]!);
    for (const o of others) consider(members[i]!, o);
  }
  return out;
}
