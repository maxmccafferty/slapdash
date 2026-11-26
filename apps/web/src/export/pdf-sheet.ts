/**
 * Page 1's drawings: the 2D `Sheet` as vector items, scaled to fit a box on the page. Sheet
 * coordinates are model mm with y down, like the page, so a point maps by one scale and one
 * offset. Strokes and text scale with the drawing, as on paper; the dot grid is left out.
 */
import { dimPrimitives } from '../drawing/dims2d.ts';
import { COLORS, STROKES, TEXT, TEXT_FILL, type StrokeStyle } from '../drawing/style.ts';
import type { Shape, Sheet, TextShape } from '../drawing/types.ts';
import type { P2 } from '../drawing/views.ts';
import type { Hex, PdfItem } from './pdf-types.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const hex = (c: string): Hex | undefined => (c === 'none' ? undefined : (c as Hex));

/** Sheet items fitted (and centred) in `box`. */
export function sheetItems(sheet: Sheet, box: Box): PdfItem[] {
  const vb = sheet.viewBox;
  const vw = vb.maxX - vb.minX;
  const vh = vb.maxY - vb.minY;
  const scale = Math.min(box.w / vw, box.h / vh);
  const ox = box.x + (box.w - vw * scale) / 2 - vb.minX * scale;
  const oy = box.y + (box.h - vh * scale) / 2 - vb.minY * scale;
  const items: PdfItem[] = [];

  let shift: P2 = { x: 0, y: 0 };
  const tx = (p: P2): P2 => ({ x: r2(ox + (p.x + shift.x) * scale), y: r2(oy + (p.y + shift.y) * scale) });
  const stroke = (style: StrokeStyle) => {
    const s = STROKES[style];
    const width = Math.max(0.25, s.widthMm * scale);
    const dash = s.dashMm?.split(/\s+/).map((v) => r2(Number(v) * scale));
    return { fill: hex(s.fill), stroke: hex(s.stroke), width: r2(width), ...(dash ? { dash } : {}) };
  };
  const text = (t: TextShape) => {
    const angle = ((t.rotate ?? 0) * Math.PI) / 180;
    // The shape gives the text's centre; the baseline is 0.35 em below it, in the text's frame.
    const drop = t.size * 0.35;
    const anchor = tx({ x: t.at.x - Math.sin(angle) * drop, y: t.at.y + Math.cos(angle) * drop });
    items.push({
      type: 'text',
      x: anchor.x,
      y: anchor.y,
      text: t.text,
      size: r2(t.size * scale),
      weight: t.weight ?? 400,
      color: TEXT_FILL[t.fill ?? 'ink'] as Hex,
      align: 'center',
      ...(t.rotate ? { rotate: t.rotate } : {}),
    });
  };
  const shape = (s: Shape) => {
    switch (s.type) {
      case 'poly': {
        const pts = s.points.map(tx);
        if (pts.length < 2) return;
        const d = `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
        items.push({ type: 'path', d, ...stroke(s.style) });
        return;
      }
      case 'line': {
        const a = tx(s.a);
        const b = tx(s.b);
        const st = stroke(s.style);
        items.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: st.stroke ?? (COLORS.ink as Hex), width: st.width, ...(st.dash ? { dash: st.dash } : {}) });
        return;
      }
      case 'arc': {
        const from = tx(s.from);
        const to = tx(s.to);
        const c = tx(s.center);
        const r = r2(Math.hypot(from.x - c.x, from.y - c.y));
        const a = { x: from.x - c.x, y: from.y - c.y };
        const b = { x: to.x - c.x, y: to.y - c.y };
        const sweep = a.x * b.y - a.y * b.x > 0 ? 1 : 0;
        const { stroke: st, width, dash } = stroke(s.style);
        items.push({ type: 'path', d: `M ${from.x} ${from.y} A ${r} ${r} 0 0 ${sweep} ${to.x} ${to.y}`, ...(st ? { stroke: st } : {}), width, ...(dash ? { dash } : {}) });
        return;
      }
      case 'text':
        text(s);
        return;
    }
  };

  for (const v of sheet.views) {
    shift = v.offset;
    for (const s of v.shapes) shape(s);
    for (const d of v.dims) {
      const p = dimPrimitives(d);
      const st = stroke('dim');
      for (const [a, b] of p.lines) {
        const pa = tx(a);
        const pb = tx(b);
        items.push({ type: 'line', x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, color: st.stroke ?? (COLORS.ink as Hex), width: st.width });
      }
      text(p.label);
    }
    for (const m of v.marks) for (const s of m.shapes) shape(s);
    for (const t of v.labels) text(t);
  }

  shift = { x: 0, y: 0 };
  if (sheet.northArrow) {
    const { at, r } = sheet.northArrow;
    const c = tx(at);
    const dot = (2 * Math.PI * r * scale) / 48;
    items.push({ type: 'circle', x: c.x, y: c.y, r: r2(r * scale), stroke: COLORS.muted as Hex, width: r2(Math.max(0.25, r * 0.05 * scale)), dash: [r2(dot * 0.3), r2(dot * 0.7)] });
    const arrow = [
      { x: at.x, y: at.y - r * 0.92 },
      { x: at.x + r * 0.15, y: at.y + r * 0.06 },
      { x: at.x, y: at.y - r * 0.06 },
      { x: at.x - r * 0.15, y: at.y + r * 0.06 },
    ].map(tx);
    items.push({ type: 'path', d: `M ${arrow.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`, fill: COLORS.ink as Hex });
    text({ type: 'text', at: { x: at.x, y: at.y - r - TEXT.north * 0.7 }, text: 'N', size: TEXT.north, weight: 600 });
  }
  if (sheet.caption) text(sheet.caption);
  return items;
}
