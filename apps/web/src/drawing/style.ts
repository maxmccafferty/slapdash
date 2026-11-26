/**
 * Every size and colour the 2D sheet uses, in one place. Lengths are sheet units: 1 sheet
 * unit = 1 model mm, so text scales with zoom like any drawing sheet. Text sizes are tuned
 * so labels are at least 14 CSS px at the fitted zoom on the 1440 × 900 desktop (the e2e
 * test checks it); on a phone the user pinches in.
 *
 * Colours are hex from `SCENE_COLORS` (never `var(--…)`), so the exported SVG stands alone.
 */
import { MM_PER_FOOT } from '@slapdash/core';
import { LABEL_FONT_FAMILY } from '../styles/fonts.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';

export { LABEL_FONT_FAMILY };

const FT = MM_PER_FOOT;
const IN = FT / 12;

export const TEXT = {
  /** Dimension labels, opening sizes, pitch labels. */
  label: 15 * IN,
  /** View titles ("North", "Plan at 4′ 0″"). */
  title: 21 * IN,
  /** The plan's footprint line. */
  subtitle: 15 * IN,
  /** The north arrow's "N". */
  north: 15 * IN,
  /** The empty-sheet caption. */
  caption: 21 * IN,
} as const;

/** Rough text width for layout: 0.6 em per character. */
export const CHAR_WIDTH_EM = 0.6;
/** Gap between a dimension line and its label. */
export const LABEL_GAP = 3 * IN;

export const LAYOUT = {
  /** Between views. */
  gap: 4 * FT,
  /** Around everything, before snapping out to whole feet. */
  margin: 4 * FT,
  /** Dot grid spacing. */
  grid: 1 * FT,
  /** Space between a view's drawing and its title. */
  titleGap: 2 * FT,
  /** The north arrow's radius. */
  northRadius: 2 * FT,
  /** The empty sheet's size. */
  empty: { width: 40 * FT, height: 30 * FT },
} as const;

export const DIM = {
  /** Plan: wall lengths, out from the exterior face. */
  wallOffset: 4 * FT,
  /** Plan: opening widths, out from the exterior face. */
  openingOffset: 1.5 * FT,
  /** Elevations: wall and ridge heights, out from the drawing's side. */
  heightOffset: 2.5 * FT,
  /** Extension lines start this far from the measured point and run this far past the line. */
  extGap: 2 * IN,
  extOver: 3 * IN,
  /** Half-length of the 45° tick. */
  tick: 3 * IN,
  /** Elevations: the ground line runs this far past the drawing. */
  groundOver: 2 * FT,
  /** Pitch triangle: the run leg's length (at most). */
  pitchRun: 2 * FT,
} as const;

export const COLORS = SCENE_COLORS;

export type StrokeStyle = 'cut' | 'outline' | 'overhead' | 'opening' | 'symbol' | 'dim' | 'ground' | 'arrow';

export interface StrokeSpec {
  fill: string;
  stroke: string;
  /** Sheet units (export). */
  widthMm: number;
  /** CSS px (on screen, non-scaling). */
  widthPx: number;
  /** Dashes in sheet units and in CSS px. */
  dashMm?: string;
  dashPx?: string;
}

export const STROKES: Record<StrokeStyle, StrokeSpec> = {
  cut: { fill: COLORS.keyDark, stroke: COLORS.keyDark, widthMm: 12, widthPx: 1 },
  outline: { fill: COLORS.paper, stroke: COLORS.ink, widthMm: 25, widthPx: 1.5 },
  overhead: { fill: 'none', stroke: COLORS.muted, widthMm: 18, widthPx: 1, dashMm: '150 100', dashPx: '6 4' },
  opening: { fill: COLORS.paper, stroke: COLORS.ink, widthMm: 15, widthPx: 1 },
  symbol: { fill: 'none', stroke: COLORS.ink, widthMm: 12, widthPx: 1 },
  dim: { fill: 'none', stroke: COLORS.ink, widthMm: 10, widthPx: 1 },
  ground: { fill: 'none', stroke: COLORS.ink, widthMm: 40, widthPx: 2 },
  arrow: { fill: COLORS.ink, stroke: 'none', widthMm: 0, widthPx: 0 },
};

/** Text colours. */
export const TEXT_FILL = { ink: COLORS.ink, muted: COLORS.muted } as const;
export type TextFill = keyof typeof TEXT_FILL;

/** Dot grid: dot radius in sheet units. */
export const GRID_DOT_RADIUS = 25;
