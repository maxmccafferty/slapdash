/**
 * The exported PDF as plain data (ADR-0003 §K.4): pages of positioned items in points,
 * y down from the top-left corner. `pdf-layout.ts` builds it (pure, testable without the
 * PDF library); `pdf-render.ts` draws it with pdf-lib.
 */

/** US letter, in points. */
export const LETTER = { width: 612, height: 792 } as const;
/** 1/2in margins. */
export const MARGIN = 36;

/** Hex colours, so the file stands alone. */
export type Hex = `#${string}`;

export interface TextItem {
  type: 'text';
  /** The anchor: left, centre or right end of the baseline, per `align`. */
  x: number;
  y: number;
  text: string;
  size: number;
  weight: 400 | 600;
  color: Hex;
  align?: 'left' | 'center' | 'right';
  /** Degrees, clockwise on the page, about the anchor. */
  rotate?: number;
}

export interface LineItem {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Hex;
  width: number;
  dash?: number[];
}

export interface RectItem {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: Hex;
  stroke?: Hex;
  width?: number;
}

export interface CircleItem {
  type: 'circle';
  x: number;
  y: number;
  r: number;
  fill?: Hex;
  stroke?: Hex;
  width?: number;
  dash?: number[];
}

/** An SVG path in page coordinates (y down). */
export interface PathItem {
  type: 'path';
  d: string;
  fill?: Hex;
  stroke?: Hex;
  width?: number;
  dash?: number[];
}

/** An empty box to tick by hand. */
export interface TickBoxItem {
  type: 'tick';
  x: number;
  y: number;
  size: number;
  color: Hex;
}

export type PdfItem = TextItem | LineItem | RectItem | CircleItem | PathItem | TickBoxItem;

export type PdfSection = 'drawings' | 'materials' | 'cut-list';

export interface PdfPage {
  section: PdfSection;
  width: number;
  height: number;
  items: PdfItem[];
}

export interface PdfDoc {
  title: string;
  pages: PdfPage[];
}
