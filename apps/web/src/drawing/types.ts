/** The sheet as plain data: no DOM, so it can be tested and exported. Sheet units are model mm, y down. */
import type { Box2 } from './geometry.ts';
import type { StrokeStyle, TextFill } from './style.ts';
import type { P2, ViewId } from './views.ts';

export type { Box2, P2, ViewId };

export type ShapeStyle = Exclude<StrokeStyle, 'dim' | 'arrow'>;

export interface PolyShape {
  type: 'poly';
  points: P2[];
  style: ShapeStyle;
  /** The assembly it draws, when there is one. */
  assemblyId?: string;
  /** A stable id for tests and later PDF tweaks (`cut:W3`, `ro:O1`, `ridge`). */
  id?: string;
}

export interface LineShape {
  type: 'line';
  a: P2;
  b: P2;
  style: ShapeStyle | 'dim';
  assemblyId?: string;
  id?: string;
}

/** A circular arc from `from` to `to` around `center`, the short way. */
export interface ArcShape {
  type: 'arc';
  center: P2;
  from: P2;
  to: P2;
  style: ShapeStyle;
  assemblyId?: string;
  id?: string;
}

export interface TextShape {
  type: 'text';
  /** The centre of the text. */
  at: P2;
  text: string;
  size: number;
  /** Degrees, clockwise on the sheet. */
  rotate?: number;
  weight?: 400 | 600;
  fill?: TextFill;
  /** A paper halo, for text drawn over linework. */
  halo?: boolean;
  id?: string;
}

export type Shape = PolyShape | LineShape | ArcShape | TextShape;

export type DimKind = 'wall-length' | 'opening' | 'wall-height' | 'ridge-height';

/** A dimension string: measured points, where the line sits (relative to them) and its label. */
export interface Dim2d {
  id: string;
  kind: DimKind;
  a: P2;
  b: P2;
  offset: P2;
  label: string;
}

/** Extra annotations that follow the Dimensions control: pitch triangles, opening sizes. */
export interface Mark {
  id: string;
  kind: 'pitch' | 'opening-size';
  shapes: Shape[];
}

/** A view before layout: what to draw, in its own frame. */
export interface ViewDraft {
  title: string;
  subtitle?: string;
  shapes: Shape[];
  dims: Dim2d[];
  marks: Mark[];
}

export interface DrawingView {
  id: ViewId;
  title: string;
  subtitle?: string;
  /** Where the view's local origin sits on the sheet. */
  offset: P2;
  shapes: Shape[];
  dims: Dim2d[];
  marks: Mark[];
  /** Title and subtitle, below the drawing. */
  labels: TextShape[];
  /** Everything above, in the view's own frame. */
  localBounds: Box2;
}

export interface Sheet {
  empty: boolean;
  views: DrawingView[];
  northArrow: { at: P2; r: number } | null;
  /** "Nothing to draw yet." on an empty sheet. */
  caption: TextShape | null;
  viewBox: Box2;
  grid: { spacing: number };
  /** The accessible description, also the SVG `<title>`. */
  description: string;
}
