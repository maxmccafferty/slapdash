/**
 * Taking an opening's framing back out of a wall, for update_opening and
 * remove_opening: the opening's kings, jacks, header, cripples, sill and unit go, and
 * the wall gets back what build_wall would have put there (common studs on layout, a
 * continuous bottom plate, whole sheathing sheets), around any other openings.
 */
import type { FrameBox } from '../../geometry/frame.ts';
import { MM_PER_INCH } from '../../units/length.ts';
import { BUILDER_DEFAULTS } from '../defaults.ts';
import { bottomPlates, cutRect, type OpeningParams } from './opening.ts';
import { commonStud, commonStudPositions, sheathingCells } from './wall.ts';
import { addMember, hasTag, removeItem, type WallState } from './wall-state.ts';

const IN = MM_PER_INCH;
const T = BUILDER_DEFAULTS.twoBy;
const GAP = 0.75 * IN;
const EPS = 1; // mm

/** What unframeOpening put back, for the summary. */
export interface Unframed {
  commons: number;
  plate: boolean;
  sheathing: number;
}

const overlaps = (a0: number, a1: number, b0: number, b1: number, tol = EPS) => a0 < b1 - tol && b0 < a1 - tol;

/**
 * Remove opening `openingId`'s framing from `state` and restore the bare wall around
 * it. `others` are the wall's other openings (their framing, plate gaps and sheathing
 * holes stay). `panelIds` are the opening's unit parts (in its O assembly, so not in the
 * state); they're added to `state.removed`. Parts someone already deleted are skipped.
 */
export function unframeOpening(
  state: WallState,
  openingId: string,
  op: OpeningParams,
  others: readonly OpeningParams[],
  panelIds: readonly string[],
): Unframed {
  const p = state.params;
  const out: Unframed = { commons: 0, plate: false, sheathing: 0 };

  // 1. The opening's own framing and its unit.
  const tag = `opening:${openingId}`;
  for (const item of [...state.items]) if (hasTag(item, tag)) removeItem(state, item);
  for (const id of panelIds) if (!state.removed.includes(id)) state.removed.push(id);

  // 2. Doors: join the bottom plate back across the old cut.
  const roU0 = op.at;
  const roU1 = op.at + op.width;
  if (op.kind !== 'window') {
    const plates = bottomPlates(state);
    const left = plates.find((i) => Math.abs(i.box.u1 - roU0) <= EPS);
    const right = plates.find((i) => Math.abs(i.box.u0 - roU1) <= EPS);
    const like = left ?? right;
    const spanned = plates.some((i) => i.box.u0 < roU0 + EPS && i.box.u1 > roU1 - EPS);
    if (like && !spanned) {
      if (left) removeItem(state, left);
      if (right) removeItem(state, right);
      addMember(state, {
        role: 'plate',
        tags: like.tags.filter((t) => !t.startsWith('opening:')),
        box: { ...like.box, u0: left?.box.u0 ?? roU0, u1: right?.box.u1 ?? roU1 },
        lengthAxis: 'u',
        widthAxis: 'v',
        materialId: like.materialId,
        sectionId: p.studSectionId,
        phase: 'framing',
      });
      out.plate = true;
    }
  }

  // 3. Common studs on layout where the old framing was, unless something else is there.
  const vac0 = op.framingU0 - GAP;
  const vac1 = op.framingU1 + GAP;
  for (const u0 of commonStudPositions(p)) {
    const u1 = u0 + T;
    if (!(u1 > vac0 && u0 < vac1)) continue;
    if (others.some((o) => u1 > o.framingU0 - GAP && u0 < o.framingU1 + GAP)) continue;
    const taken = state.items.some(
      (i) => i.role === 'stud' && overlaps(i.box.u0, i.box.u1, u0, u1) && overlaps(i.box.w0, i.box.w1, 0, p.depth),
    );
    if (taken) continue;
    commonStud(state, u0);
    out.commons++;
  }

  // 4. Whole sheets back over the old hole, cut around the other openings.
  const hole = { u0: roU0, u1: roU1, v0: op.roBottom, v1: op.roTop };
  const otherHoles = others.map((o) => ({ u0: o.at, u1: o.at + o.width, v0: o.roBottom, v1: o.roTop }));
  for (const cell of sheathingCells(p)) {
    if (!overlaps(cell.u0, cell.u1, hole.u0, hole.u1) || !overlaps(cell.v0, cell.v1, hole.v0, hole.v1)) continue;
    const inside = state.items.filter(
      (i) =>
        i.role === 'sheathing' &&
        i.box.u0 >= cell.u0 - EPS &&
        i.box.u1 <= cell.u1 + EPS &&
        i.box.v0 >= cell.v0 - EPS &&
        i.box.v1 <= cell.v1 + EPS,
    );
    // No sheathing left in this cell: someone took it off on purpose, so leave it off.
    const first = inside[0];
    if (!first) continue;
    for (const item of inside) removeItem(state, item);
    let pieces: FrameBox[] = [cell];
    for (const h of otherHoles) pieces = pieces.flatMap((r) => cutRect(r, h));
    for (const box of pieces) {
      addMember(state, {
        role: 'sheathing',
        tags: first.tags,
        box,
        lengthAxis: 'u',
        widthAxis: 'v',
        materialId: first.materialId,
        phase: 'sheathing',
      });
      out.sheathing++;
    }
  }
  return out;
}
