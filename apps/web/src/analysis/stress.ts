/**
 * The stress view's rules (ADR-0003 §C, §A3), pure: the five bands on utilisation, what
 * counts as checked, the most loaded visible part, the callout wording and when Claude
 * explains unprompted.
 *
 * Bands are equal fifths of the limit: three greys (0–20, 20–40, 40–60%), two oranges
 * (60–80, 80–100%), then "over" (ink, hatched, with a warning mark). Parts the solver
 * doesn't check (roofing, siding, door units, a slab on the ground) are "unchecked" and
 * draw as a pale ghost so the framing shows through.
 */
import { partLabel, type Project } from '@slapdash/core';
import { stressContextOf, type StressContext } from '@slapdash/agent';
import type { AnalysisResult, PartResult } from '@slapdash/solver';

export type StressBand = 0 | 1 | 2 | 3 | 4 | 'over' | 'unchecked';

export const STRESS_BANDS: ReadonlyArray<{ band: Exclude<StressBand, 'unchecked'>; label: string }> = [
  { band: 0, label: '0–20%' },
  { band: 1, label: '20–40%' },
  { band: 2, label: '40–60%' },
  { band: 3, label: '60–80%' },
  { band: 4, label: '80–100%' },
  { band: 'over', label: 'Over limit' },
];

/** The top orange band starts here: at or past it, Claude explains unprompted. */
export const EXPLAIN_THRESHOLD = 0.8;

const CHECKED: ReadonlySet<PartResult['role']> = new Set(['member', 'truss', 'panel']);

export const isChecked = (r: PartResult | undefined): r is PartResult => r !== undefined && CHECKED.has(r.role);

/** The band for a utilisation (upper edges inclusive: 20% is the first grey, 100% the top orange). */
export function bandFor(u: number): Exclude<StressBand, 'unchecked'> {
  if (u > 1) return 'over';
  if (u <= 0) return 0;
  return Math.min(4, Math.max(0, Math.ceil(u / 0.2 - 1e-9) - 1)) as 0 | 1 | 2 | 3 | 4;
}

export function stressBand(r: PartResult | undefined): StressBand {
  return isChecked(r) ? bandFor(r.utilization) : 'unchecked';
}

/** The band of every part in the project. */
export function stressBands(project: Project, result: AnalysisResult): Map<string, StressBand> {
  const out = new Map<string, StressBand>();
  for (const id of Object.keys(project.parts)) out.set(id, stressBand(result.parts[id]));
  return out;
}

export interface Loaded {
  id: string;
  label: string;
  utilization: number;
}

/** The most loaded checked part that's visible, or null. */
export function mostLoaded(result: AnalysisResult, project: Project, isVisible: (id: string) => boolean): Loaded | null {
  let best: PartResult | null = null;
  for (const r of Object.values(result.parts)) {
    if (!isChecked(r) || !Object.hasOwn(project.parts, r.id) || !isVisible(r.id)) continue;
    if (!best || r.utilization > best.utilization || (r.utilization === best.utilization && r.id < best.id)) best = r;
  }
  return best ? { id: best.id, label: partLabel(project, best.id) ?? best.id, utilization: best.utilization } : null;
}

const nearest5 = (u: number) => Math.round((u * 100) / 5) * 5;

/** "Header, South wall · about 90% of its limit", or "… · over its limit (about 140%)". */
export function calloutText(label: string, u: number): string {
  return u > 1 ? `${label} · over its limit (about ${nearest5(u)}%)` : `${label} · about ${nearest5(u)}% of its limit`;
}

/** What the automatic turn tells Claude, over the visible parts. */
export function stressContext(project: Project, result: AnalysisResult, isVisible: (id: string) => boolean = () => true): StressContext {
  return stressContextOf(project, result, isVisible);
}

/** Claude explains unprompted only when it matters: the top orange band, over, or unstable. */
export function shouldExplain(ctx: StressContext): boolean {
  return ctx.unstable.length > 0 || ctx.overCount > 0 || (ctx.worst?.utilization ?? 0) >= EXPLAIN_THRESHOLD;
}
