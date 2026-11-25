/**
 * The sheet as a standalone SVG file, for page 1 of the exported PDF (ADR-0003 §K.4) and for
 * a manual look. `react-dom/server` is loaded on demand, so it stays out of the main chunk.
 */
import { createElement } from 'react';
import type { Project } from '@slapdash/core';
import { DrawingSheet } from './DrawingSheet.tsx';
import { buildSheet, type SheetOptions } from './sheet.ts';
import type { Sheet } from './types.ts';

const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>\n';

export const EXPORT_DEFAULTS: SheetOptions = { floor: 'roof', dimensions: true };

export async function sheetToSvg(sheet: Sheet, opts: { nonScalingStroke?: boolean } = {}): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  return PROLOG + renderToStaticMarkup(createElement(DrawingSheet, { sheet, nonScalingStroke: opts.nonScalingStroke }));
}

export function drawingSheetSvg(project: Project, opts: SheetOptions = EXPORT_DEFAULTS): Promise<string> {
  return sheetToSvg(buildSheet(project, opts));
}
