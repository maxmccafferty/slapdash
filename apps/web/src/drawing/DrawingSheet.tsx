/**
 * Draws a `Sheet` as SVG. The same component draws on screen (with a pan/zoom `viewBox`
 * and non-scaling hairlines) and exports (`svg.ts`), so the two can't drift apart. Colours
 * are hex attributes and sizes are sheet units, so the export stands alone.
 */
import { memo } from 'react';
import { dimPrimitives } from './dims2d.ts';
import type { Box2 } from './geometry.ts';
import { COLORS, GRID_DOT_RADIUS, LABEL_FONT_FAMILY, STROKES, TEXT, TEXT_FILL, type StrokeStyle } from './style.ts';
import type { DrawingView, Mark, Shape, Sheet, TextShape } from './types.ts';
import type { P2 } from './views.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOTS_ID = 'slapdash-sheet-dots';

/** Sheet numbers to 0.1 mm: plenty for drawing, and a compact file. */
const f = (n: number) => String(Math.round(n * 10) / 10);
const pts = (points: readonly P2[]) => points.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');

export function viewBoxAttr(b: Box2): string {
  return `${f(b.minX)} ${f(b.minY)} ${f(b.maxX - b.minX)} ${f(b.maxY - b.minY)}`;
}

function strokeProps(style: StrokeStyle, nonScaling: boolean) {
  const s = STROKES[style];
  const dash = nonScaling ? s.dashPx : s.dashMm;
  return {
    fill: s.fill,
    stroke: s.stroke,
    strokeWidth: nonScaling ? s.widthPx : s.widthMm,
    strokeLinejoin: 'round' as const,
    ...(dash ? { strokeDasharray: dash } : {}),
    ...(nonScaling ? { vectorEffect: 'non-scaling-stroke' } : {}),
  };
}

function Text({ t }: { t: TextShape }) {
  const rotate = t.rotate ? `rotate(${f(t.rotate)} ${f(t.at.x)} ${f(t.at.y)})` : undefined;
  return (
    <text
      x={f(t.at.x)}
      // The centre is given; the baseline sits about 0.35 em below it.
      y={f(t.at.y + t.size * 0.35)}
      transform={rotate}
      textAnchor="middle"
      fontFamily={LABEL_FONT_FAMILY}
      fontSize={f(t.size)}
      fontWeight={t.weight ?? 400}
      fill={TEXT_FILL[t.fill ?? 'ink']}
      {...(t.halo ? { stroke: COLORS.paper, strokeWidth: f(t.size * 0.3), strokeLinejoin: 'round' as const, paintOrder: 'stroke' } : {})}
      data-id={t.id}
    >
      {t.text}
    </text>
  );
}

function ShapeEl({ s, nonScaling }: { s: Shape; nonScaling: boolean }) {
  switch (s.type) {
    case 'poly':
      return <polygon points={pts(s.points)} {...strokeProps(s.style, nonScaling)} data-id={s.id} />;
    case 'line':
      return <line x1={f(s.a.x)} y1={f(s.a.y)} x2={f(s.b.x)} y2={f(s.b.y)} {...strokeProps(s.style, nonScaling)} data-id={s.id} />;
    case 'arc': {
      const r = Math.hypot(s.from.x - s.center.x, s.from.y - s.center.y);
      const a = { x: s.from.x - s.center.x, y: s.from.y - s.center.y };
      const b = { x: s.to.x - s.center.x, y: s.to.y - s.center.y };
      const sweep = a.x * b.y - a.y * b.x > 0 ? 1 : 0;
      const d = `M ${f(s.from.x)} ${f(s.from.y)} A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(s.to.x)} ${f(s.to.y)}`;
      return <path d={d} {...strokeProps(s.style, nonScaling)} fill="none" data-id={s.id} />;
    }
    case 'text':
      return <Text t={s} />;
  }
}

function MarkEl({ m, nonScaling }: { m: Mark; nonScaling: boolean }) {
  return (
    <g data-mark={m.id}>
      {m.shapes.map((s, i) => (
        <ShapeEl key={i} s={s} nonScaling={nonScaling} />
      ))}
    </g>
  );
}

function ViewEl({ v, nonScaling }: { v: DrawingView; nonScaling: boolean }) {
  return (
    <g data-view={v.id} transform={`translate(${f(v.offset.x)} ${f(v.offset.y)})`}>
      {v.shapes.map((s, i) => (
        <ShapeEl key={i} s={s} nonScaling={nonScaling} />
      ))}
      {v.dims.map((d) => {
        const p = dimPrimitives(d);
        return (
          <g key={d.id} data-dim={d.id}>
            {p.lines.map(([a, b], i) => (
              <line key={i} x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} {...strokeProps('dim', nonScaling)} />
            ))}
            <Text t={p.label} />
          </g>
        );
      })}
      {v.marks.map((m) => (
        <MarkEl key={m.id} m={m} nonScaling={nonScaling} />
      ))}
      {v.labels.map((t, i) => (
        <Text key={i} t={t} />
      ))}
    </g>
  );
}

/** A dotted ring, a solid arrow to sheet-up (north) and an "N", like the 3D compass. */
function NorthArrow({ at, r }: { at: P2; r: number }) {
  const dot = (2 * Math.PI * r) / 48;
  const arrow = [
    { x: at.x, y: at.y - r * 0.92 },
    { x: at.x + r * 0.15, y: at.y + r * 0.06 },
    { x: at.x, y: at.y - r * 0.06 },
    { x: at.x - r * 0.15, y: at.y + r * 0.06 },
  ];
  return (
    <g data-north-arrow="">
      <circle cx={f(at.x)} cy={f(at.y)} r={f(r)} fill="none" stroke={COLORS.muted} strokeWidth={f(r * 0.05)} strokeLinecap="round" strokeDasharray={`0 ${f(dot)}`} />
      <polygon points={pts(arrow)} fill={COLORS.ink} />
      <Text t={{ type: 'text', at: { x: at.x, y: at.y - r - TEXT.north * 0.7 }, text: 'N', size: TEXT.north, weight: 600 }} />
    </g>
  );
}

/** Everything inside the `<svg>`: memoised, so pan and zoom only touch the root `viewBox`. */
export const SheetContent = memo(function SheetContent({ sheet, nonScalingStroke = false }: { sheet: Sheet; nonScalingStroke?: boolean }) {
  const b = sheet.viewBox;
  const g = sheet.grid.spacing;
  return (
    <>
      <title>{sheet.description}</title>
      <defs>
        <pattern id={DOTS_ID} patternUnits="userSpaceOnUse" x={f(-g / 2)} y={f(-g / 2)} width={f(g)} height={f(g)}>
          <circle cx={f(g / 2)} cy={f(g / 2)} r={f(GRID_DOT_RADIUS)} fill={COLORS.dot} />
        </pattern>
      </defs>
      <rect x={f(b.minX)} y={f(b.minY)} width={f(b.maxX - b.minX)} height={f(b.maxY - b.minY)} fill={COLORS.paper} />
      <rect x={f(b.minX)} y={f(b.minY)} width={f(b.maxX - b.minX)} height={f(b.maxY - b.minY)} fill={`url(#${DOTS_ID})`} />
      {sheet.views.map((v) => (
        <ViewEl key={v.id} v={v} nonScaling={nonScalingStroke} />
      ))}
      {sheet.northArrow && <NorthArrow {...sheet.northArrow} />}
      {sheet.caption && <Text t={sheet.caption} />}
    </>
  );
});

export interface DrawingSheetProps {
  sheet: Sheet;
  /** On screen: the pan/zoom window. Defaults to the whole sheet. */
  viewBox?: Box2;
  /** On screen: hairlines stay one pixel at any zoom. */
  nonScalingStroke?: boolean;
  className?: string;
}

export function DrawingSheet({ sheet, viewBox, nonScalingStroke, className }: DrawingSheetProps) {
  return (
    <svg xmlns={SVG_NS} viewBox={viewBoxAttr(viewBox ?? sheet.viewBox)} className={className} data-sheet="">
      <SheetContent sheet={sheet} nonScalingStroke={nonScalingStroke} />
    </svg>
  );
}
