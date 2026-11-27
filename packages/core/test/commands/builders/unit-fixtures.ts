/** A test catalog with window and door units of every style, and helpers to look at them. */
import { DEFAULT_UNIT_SPECS, SAMPLE_CATALOG, indexCatalog, type Material, type OpeningUnit, type Part, type Project } from '../../../src/index.ts';
import { boxInFrame, type FrameBox } from '../../../src/geometry/frame.ts';
import { wallFrame, wallParamsOf } from '../../../src/builders/layout/wall-state.ts';
import type { CommandContext } from '../../../src/commands/types.ts';
import { fixedClock } from '../../helpers.ts';

const IN = 25.4;
const JOINTS = ['nailed-16d', 'nailed-roofing', 'screwed-structural', 'factory-assembled'];
const product = (id: string, name: string, unit?: OpeningUnit): Material => ({
  id,
  name,
  category: 'opening',
  acceptsJoints: JOINTS,
  ...(unit ? { unit } : {}),
});
const win = DEFAULT_UNIT_SPECS.window;

/**
 * The sample catalog plus a generic unit (first to take 16d nails, with no `unit` of its
 * own, so it's drawn from the defaults) and a product per style.
 */
export const UNIT_CATALOG = indexCatalog({
  ...SAMPLE_CATALOG,
  materials: [
    ...SAMPLE_CATALOG.materials,
    product('opening-unit', 'Generic unit'),
    product('win-fixed', 'Fixed window', { ...win, style: 'fixed' }),
    product('win-awning', 'Awning window', { ...win, style: 'awning' }),
    product('win-double-hung', 'Double-hung window', { ...win, style: 'double-hung' }),
    product('win-single-hung', 'Single-hung window', { ...win, style: 'single-hung' }),
    product('win-slider', 'Sliding window', { ...win, style: 'slider' }),
    product('win-twin', 'Twin casement', { ...win, style: 'casement', lites: 2 }),
    product('door-slab', 'Entry door', {
      ...DEFAULT_UNIT_SPECS.door,
      casing: { width_mm: 2 * IN, thickness_mm: 1.25 * IN },
    }),
    product('door-glass', 'Sliding glass door', DEFAULT_UNIT_SPECS['sliding-door']),
  ],
});

export const unitCtx: Partial<CommandContext> = { catalog: UNIT_CATALOG, now: fixedClock() };

export const unitParts = (p: Project, id = 'O1') =>
  Object.values(p.parts)
    .filter((x) => x.assemblyId === id && x.tags.includes('unit'))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
export const piece = (parts: Part[], name: string) => parts.filter((x) => x.tags.includes(`unit:${name}`));

/** A part's box in its opening's wall frame (u along the wall, v up, w in from the outside face). */
export function wallBox(p: Project, part: Part): FrameBox {
  const op = p.assemblies[part.assemblyId]!.builder!.params as { wallId: string };
  return boxInFrame(wallFrame(wallParamsOf(p, op.wallId)!), part);
}

/** The bounds of some parts in the wall frame. */
export function bounds(p: Project, parts: Part[]): FrameBox {
  const boxes = parts.map((x) => wallBox(p, x));
  return {
    u0: Math.min(...boxes.map((b) => b.u0)),
    u1: Math.max(...boxes.map((b) => b.u1)),
    v0: Math.min(...boxes.map((b) => b.v0)),
    v1: Math.max(...boxes.map((b) => b.v1)),
    w0: Math.min(...boxes.map((b) => b.w0)),
    w1: Math.max(...boxes.map((b) => b.w1)),
  };
}
