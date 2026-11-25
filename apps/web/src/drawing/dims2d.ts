/**
 * Dimension strings as primitives: extension lines, the dimension line, 45° architectural
 * ticks and the label, which sits on the outer side of the line and reads along it
 * (rotated −90° on vertical strings). The same primitives draw the dimension and give its
 * bounds, so layout and drawing agree.
 */
import { bounds2d, type Box2 } from './geometry.ts';
import { CHAR_WIDTH_EM, DIM, LABEL_GAP, TEXT } from './style.ts';
import type { Dim2d, Shape, TextShape } from './types.ts';
import type { P2 } from './views.ts';

const add = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: P2, k: number): P2 => ({ x: a.x * k, y: a.y * k });
const len = (a: P2) => Math.hypot(a.x, a.y);
const unit = (a: P2): P2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: -1 } : { x: a.x / l, y: a.y / l };
};

export interface DimPrimitives {
  lines: Array<[P2, P2]>;
  label: TextShape;
}

export function dimPrimitives(dim: Dim2d): DimPrimitives {
  const n = unit(dim.offset);
  const pa = add(dim.a, dim.offset);
  const pb = add(dim.b, dim.offset);
  const lines: Array<[P2, P2]> = [];
  const off = len(dim.offset);
  // Extension lines, unless the dimension line sits on the measured points.
  if (off > DIM.extGap) {
    lines.push([add(dim.a, mul(n, DIM.extGap)), add(pa, mul(n, DIM.extOver))]);
    lines.push([add(dim.b, mul(n, DIM.extGap)), add(pb, mul(n, DIM.extOver))]);
  }
  lines.push([pa, pb]);
  // 45° ticks: the line direction turned 45° toward the offset.
  const d = unit({ x: pb.x - pa.x, y: pb.y - pa.y });
  const t = mul(unit(add(d, n)), DIM.tick);
  for (const p of [pa, pb]) lines.push([add(p, mul(t, -1)), add(p, t)]);

  // The label reads along the line, upright (rotation kept within (−90°, 90°]).
  let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  if (Math.abs(Math.abs(angle) - 90) < 1e-6) angle = -90;
  const mid = mul(add(pa, pb), 0.5);
  const size = TEXT.label;
  // The label's centre sits half its height plus a gap outside the line.
  const half = size / 2;
  const at = add(mid, mul(n, LABEL_GAP + half));
  return { lines, label: { type: 'text', at, text: dim.label, size, rotate: angle || undefined } };
}

export function textWidth(text: string, size: number): number {
  return text.length * size * CHAR_WIDTH_EM;
}

/** The bounds of a text shape (its rotated box). */
export function textBounds(t: TextShape): Box2 {
  const w = textWidth(t.text, t.size) / 2;
  const h = t.size / 2;
  const r = ((t.rotate ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const ex = w * c + h * s;
  const ey = w * s + h * c;
  return { minX: t.at.x - ex, minY: t.at.y - ey, maxX: t.at.x + ex, maxY: t.at.y + ey };
}

export function shapeBounds(s: Shape): Box2 | null {
  switch (s.type) {
    case 'poly':
      return bounds2d(s.points);
    case 'line':
      return bounds2d([s.a, s.b]);
    case 'arc':
      // Door swings are quarter arcs: the box of the ends and the centre holds them.
      return bounds2d([s.from, s.to, s.center]);
    case 'text':
      return textBounds(s);
  }
}

export function dimBounds(dim: Dim2d): Box2 {
  const p = dimPrimitives(dim);
  const b = bounds2d(p.lines.flat())!;
  const t = textBounds(p.label);
  return { minX: Math.min(b.minX, t.minX), minY: Math.min(b.minY, t.minY), maxX: Math.max(b.maxX, t.maxX), maxY: Math.max(b.maxY, t.maxY) };
}
