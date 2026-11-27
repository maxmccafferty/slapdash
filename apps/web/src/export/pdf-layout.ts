/**
 * Lays out the exported PDF (ADR-0003 §K.4, HANDOFF § Exported PDF) as plain data: US
 * letter, 1/2in margins, each section on a new page and a long list carried onto more
 * pages with its group header repeated.
 *
 * 1. Drawings: the name and specs, then the 2D sheet (plan and four elevations) as vectors.
 * 2. Materials: by build step with Amount and Cost, the Total row, the price date and caveat.
 *    A price the person gave shows an orange dot.
 * 3. Cut list: by stock board, a tick box per piece row, in two columns. A cut piece gets
 *    a second line in small type with its cuts ("long point · plumb 26.6° both ends").
 *
 * Every page has a footer: the project, "Planning estimate, not a quote" and "Page n of N".
 * Pure: no fonts, no PDF library. Text widths are estimated for truncation only; the
 * renderer aligns with real font metrics.
 */
import type { CutListGroup, MaterialsGroup, MaterialsReport, MaterialsRow } from '@slapdash/core';
import type { Sheet } from '../drawing/types.ts';
import {
  NO_PRICE,
  boardCount,
  boardTitle,
  formatAmount,
  formatCost,
  formatCutLabel,
  formatCutLength,
  formatTotal,
  priceDateNote,
  rowLabel,
  unpricedNote,
} from '../materials/format.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';
import { sheetItems } from './pdf-sheet.ts';
import { LETTER, MARGIN, type Hex, type PdfDoc, type PdfItem, type PdfPage, type PdfSection } from './pdf-types.ts';

export interface PdfInput {
  name: string;
  specs: ReadonlyArray<{ label: string; value: string }>;
  sheet: Sheet;
  report: MaterialsReport;
  /** "25 Nov 2026". */
  exportedOn: string;
}

const INK = SCENE_COLORS.ink as Hex;
const MUTED = SCENE_COLORS.muted as Hex;
const HAIRLINE = SCENE_COLORS.hairline as Hex;
const SIGNAL = SCENE_COLORS.signal as Hex;

export const FOOTER_NOTE = 'Planning estimate, not a quote';

const LEFT = MARGIN;
const RIGHT = LETTER.width - MARGIN;
const TOP = MARGIN;
/** Content stops here; the footer sits below. */
const BOTTOM = LETTER.height - MARGIN - 18;
const FOOTER_Y = LETTER.height - MARGIN + 4;

const TYPE = {
  name: 26,
  heading: 18,
  group: 11,
  body: 9.5,
  small: 8,
} as const;

const ROW = 17;
const CUT_ROW = 15;
/** Each extra small-type line under a row (cut labels, sheet details). */
const DETAIL_LINE = 10;

/** Rough text width (0.55 em a character) for truncation. */
export function estimateWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

function truncate(text: string, size: number, max: number): string {
  if (estimateWidth(text, size) <= max) return text;
  let out = text;
  while (out.length > 1 && estimateWidth(`${out}…`, size) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** Words into lines no wider than `max` (estimated). */
export function wrap(s: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && estimateWidth(next, size) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const text = (x: number, y: number, s: string, size: number, opts: Partial<Omit<Extract<PdfItem, { type: 'text' }>, 'type'>> = {}): PdfItem => ({
  type: 'text',
  x,
  y,
  text: s,
  size,
  weight: 400,
  color: INK,
  align: 'left',
  ...opts,
});

const hairline = (y: number, x1 = LEFT, x2 = RIGHT, color: Hex = HAIRLINE, width = 0.5): PdfItem => ({ type: 'line', x1, y1: y, x2, y2: y, color, width });

/** A run of pages for one section. */
class Pages {
  readonly pages: PdfPage[] = [];
  page!: PdfPage;
  y = TOP;

  readonly section: PdfSection;

  constructor(section: PdfSection) {
    this.section = section;
    this.add();
  }

  add(): void {
    this.page = { section: this.section, width: LETTER.width, height: LETTER.height, items: [] };
    this.pages.push(this.page);
    this.y = TOP;
  }

  push(...items: PdfItem[]): void {
    this.page.items.push(...items);
  }

  fits(h: number): boolean {
    return this.y + h <= BOTTOM;
  }
}

function sectionHeading(p: Pages, title: string): void {
  p.y += TYPE.heading;
  p.push(text(LEFT, p.y, title, TYPE.heading, { weight: 600 }));
  p.y += 12;
}

// ── Page 1: drawings ─────────────────────────────────────────────────────────

function drawingsPages(input: PdfInput): PdfPage[] {
  const p = new Pages('drawings');
  p.y += TYPE.name;
  p.push(text(LEFT, p.y, input.name, TYPE.name));
  p.push(text(RIGHT, p.y, `Exported ${input.exportedOn}`, TYPE.small, { color: MUTED, align: 'right' }));
  p.y += 14;
  // The ruled specs, side by side.
  const colW = (RIGHT - LEFT) / Math.max(1, input.specs.length);
  input.specs.forEach((spec, i) => {
    const x = LEFT + i * colW;
    p.push(hairline(p.y, x, x + colW - 8, INK, 0.75));
    p.push(text(x, p.y + 12, spec.label, TYPE.small, { color: MUTED }));
    p.push(text(x, p.y + 26, spec.value, TYPE.group));
  });
  p.y += 40;
  p.push(...sheetItems(input.sheet, { x: LEFT, y: p.y, w: RIGHT - LEFT, h: BOTTOM - p.y }));
  return p.pages;
}

// ── Page 2: materials ────────────────────────────────────────────────────────

const AMOUNT_RIGHT = RIGHT - 110;
const NAME_MAX = AMOUNT_RIGHT - 80 - (LEFT + 14);

function groupHeader(p: Pages, group: MaterialsGroup, continued: boolean): void {
  p.y += TYPE.group + 6;
  p.push(text(LEFT, p.y, continued ? `${group.title} (continued)` : group.title, TYPE.group, { weight: 600 }));
  p.push(text(AMOUNT_RIGHT, p.y, 'Amount', TYPE.small, { color: MUTED, align: 'right' }));
  p.push(text(RIGHT, p.y, 'Cost', TYPE.small, { color: MUTED, align: 'right' }));
  p.y += 5;
  p.push(hairline(p.y, LEFT, RIGHT, INK, 0.5));
}

/**
 * A " · "-separated label into lines no wider than `max`, breaking only between its parts
 * (so "3 15/16″" never splits); a part too wide on its own is word-wrapped.
 */
function wrapParts(label: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const part of label.split(' · ')) {
    const next = line === '' ? part : `${line} ·`;
    if (line !== '' && estimateWidth(`${line} · ${part}`, size) <= max) {
      line = `${line} · ${part}`;
      continue;
    }
    if (line !== '') lines.push(next);
    if (estimateWidth(part, size) <= max) line = part;
    else {
      const words = wrap(part, size, max);
      lines.push(...words.slice(0, -1));
      line = words[words.length - 1] ?? '';
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** The small-type lines under a materials row (e.g. "6 × bevel 26.6° one edge"). */
function detailLines(row: MaterialsRow): string[] {
  return (row.details ?? []).flatMap((d) => wrap(d, TYPE.small, NAME_MAX - 14));
}

function materialRowHeight(row: MaterialsRow): number {
  return ROW + detailLines(row).length * DETAIL_LINE;
}

function materialRow(p: Pages, row: MaterialsRow): void {
  const top = p.y;
  const base = top + ROW - 5.5;
  const { name, detail } = rowLabel(row);
  if (row.swatch) p.push({ type: 'circle', x: LEFT + 4.5, y: top + ROW / 2, r: 4.5, fill: row.swatch.color as Hex, stroke: SCENE_COLORS.dot as Hex, width: 0.4 });
  else p.push({ type: 'circle', x: LEFT + 4.5, y: top + ROW / 2, r: 4.5, stroke: SCENE_COLORS.dot as Hex, width: 0.4 });
  p.push(text(LEFT + 14, base, truncate(detail ? `${name} · ${detail}` : name, TYPE.body, NAME_MAX), TYPE.body));
  p.push(text(AMOUNT_RIGHT, base, formatAmount(row), TYPE.body, { align: 'right' }));
  if (row.cost) {
    const cost = formatCost(row.cost);
    p.push(text(RIGHT, base, cost, TYPE.body, { align: 'right' }));
    if (row.cost.user) p.push({ type: 'circle', x: RIGHT - estimateWidth(cost, TYPE.body) - 7, y: base - TYPE.body * 0.33, r: 2.5, fill: SIGNAL });
  } else {
    p.push(text(RIGHT, base, NO_PRICE, TYPE.body, { color: MUTED, align: 'right' }));
  }
  p.y += ROW;
  for (const line of detailLines(row)) {
    p.push(text(LEFT + 14, p.y - 3, line, TYPE.small, { color: MUTED }));
    p.y += DETAIL_LINE;
  }
  p.push(hairline(p.y));
}

function materialsPages(input: PdfInput): PdfPage[] {
  const p = new Pages('materials');
  const { report } = input;
  sectionHeading(p, 'Materials');
  if (report.isEmpty) {
    p.y += 14;
    p.push(text(LEFT, p.y, 'Nothing built yet.', TYPE.body, { color: MUTED }));
    return p.pages;
  }
  p.y += 8;
  p.push(text(LEFT, p.y, formatTotal(report.totals), 14, { weight: 600 }));
  const note = unpricedNote(report.totals);
  if (note) p.push(text(RIGHT, p.y, note, TYPE.small, { color: MUTED, align: 'right' }));
  p.y += 8;

  for (const group of report.groups) {
    // A header and at least one row, or a new page.
    if (!p.fits(TYPE.group + 11 + materialRowHeight(group.rows[0]!))) p.add();
    groupHeader(p, group, false);
    for (const row of group.rows) {
      if (!p.fits(materialRowHeight(row))) {
        p.add();
        groupHeader(p, group, true);
      }
      materialRow(p, row);
    }
    p.y += 6;
  }

  if (!p.fits(ROW + 40)) p.add();
  p.y += 4;
  p.push(hairline(p.y, LEFT, RIGHT, INK, 1));
  p.y += ROW - 4;
  p.push(text(LEFT, p.y, 'Total', TYPE.group, { weight: 600 }));
  p.push(text(RIGHT, p.y, formatTotal(report.totals), TYPE.group, { weight: 600, align: 'right' }));
  p.y += 18;
  p.push(text(LEFT, p.y, priceDateNote(report.totals), TYPE.small, { color: MUTED }));
  // The table's caveat, less the sentence the date line already says.
  const caveat = report.totals.note.replace(/^Planning estimates, not quotes\.\s*/, '');
  for (const line of wrap(caveat, TYPE.small, RIGHT - LEFT)) {
    p.y += 11;
    p.push(text(LEFT, p.y, line, TYPE.small, { color: MUTED }));
  }
  if (report.totals.hasUserPrices) {
    p.y += 11;
    p.push({ type: 'circle', x: LEFT + 2.5, y: p.y - 2.6, r: 2.5, fill: SIGNAL });
    p.push(text(LEFT + 9, p.y, 'Your own price, in place of the price table.', TYPE.small, { color: MUTED }));
  }
  return p.pages;
}

// ── Page 3: cut list ─────────────────────────────────────────────────────────

const GUTTER = 24;
const COL_W = (RIGHT - LEFT - GUTTER) / 2;
const CUT_HEADER = 30;

function cutListPages(input: PdfInput): PdfPage[] {
  const p = new Pages('cut-list');
  sectionHeading(p, 'Cut list');
  const groups = input.report.cutList;
  if (groups.length === 0) {
    p.y += 14;
    p.push(text(LEFT, p.y, 'Nothing to cut.', TYPE.body, { color: MUTED }));
    return p.pages;
  }
  p.y += 4;
  const top = () => (p.pages.length === 1 ? TOP + TYPE.heading + 16 : TOP);
  let col = 0;
  let y = p.y;
  const x = () => LEFT + col * (COL_W + GUTTER);
  const nextColumn = () => {
    if (col === 0) {
      col = 1;
      y = top();
    } else {
      p.add();
      col = 0;
      y = TOP;
    }
  };
  const header = (g: CutListGroup, continued: boolean) => {
    y += TYPE.group;
    const title = `${boardTitle(g)} — ${boardCount(g.boards)}${continued ? ' (continued)' : ''}`;
    p.push(text(x(), y, truncate(title, TYPE.group - 1, COL_W), TYPE.group - 1, { weight: 600 }));
    y += 11;
    p.push(text(x(), y, truncate(g.materialName, TYPE.small, COL_W), TYPE.small, { color: MUTED }));
    y += 5;
    p.push(hairline(y, x(), x() + COL_W, INK, 0.5));
  };
  for (const g of groups) {
    if (y + CUT_HEADER + CUT_ROW + DETAIL_LINE * 2 > BOTTOM) nextColumn();
    header(g, false);
    for (const row of g.pieces) {
      const label = formatCutLabel(row.cuts);
      const lines = label ? wrapParts(label, TYPE.small, COL_W - 14) : [];
      const height = CUT_ROW + lines.length * DETAIL_LINE;
      if (y + height > BOTTOM) {
        nextColumn();
        header(g, true);
      }
      const base = y + CUT_ROW - 4.5;
      p.push({ type: 'tick', x: x(), y: base - 7.5, size: 8, color: INK });
      p.push(text(x() + 14, base, `${formatCutLength(row.length_mm)}${row.spliced ? ' (spliced)' : ''}`, TYPE.body));
      p.push(text(x() + COL_W, base, `× ${row.count}`, TYPE.body, { align: 'right' }));
      y += CUT_ROW;
      for (const line of lines) {
        p.push(text(x() + 14, y - 3, line, TYPE.small, { color: MUTED }));
        y += DETAIL_LINE;
      }
      p.push(hairline(y, x(), x() + COL_W));
    }
    y += 10;
  }
  return p.pages;
}

// ── Document ─────────────────────────────────────────────────────────────────

/** The whole PDF: drawings, materials and cut list, each from a new page, with footers. */
export function layoutPdf(input: PdfInput): PdfDoc {
  const pages = [...drawingsPages(input), ...materialsPages(input), ...cutListPages(input)];
  const footerLeft = truncate(`${input.name} · ${FOOTER_NOTE}`, TYPE.small, RIGHT - LEFT - 80);
  pages.forEach((page, i) => {
    page.items.push(hairline(FOOTER_Y - 10, LEFT, RIGHT));
    page.items.push(text(LEFT, FOOTER_Y, footerLeft, TYPE.small, { color: MUTED }));
    page.items.push(text(RIGHT, FOOTER_Y, `Page ${i + 1} of ${pages.length}`, TYPE.small, { color: MUTED, align: 'right' }));
  });
  return { title: `${input.name}: drawings, materials and cut list`, pages };
}
