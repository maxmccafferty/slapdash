/**
 * `check_structure` (ADR-0003 §C, §K1): the structural check as Claude reads it. The app
 * runs the solver (in a Web Worker in the browser, directly in Node for evals) through an
 * `AnalysisProvider`; this module turns its result into compact text: the disclaimer, the
 * design loads with their sources, the status, the most loaded part, everything over its
 * limit and the top few. Also the `<stress_view>` note that starts the automatic turn
 * when the person turns Stress on.
 */
import { KPA_PER_PSF, formatLoad, zId, partLabel, type DesignLoadKey, type Project } from '@slapdash/core';
import type { AnalysisResult, Governing, JointResult, PartResult, SourcedValue } from '@slapdash/solver';
import { z } from 'zod';
import { compareIds } from '../format.ts';

/** Runs the structural analysis on a project. Rejects when it can't. */
export type AnalysisProvider = (project: Project) => Promise<AnalysisResult>;

export const STRUCTURE_DISCLAIMER = 'Planning estimate, not an engineering check; confirm with the building department or an engineer.';

export const zCheckStructure = z.strictObject({
  assembly: zId.optional().describe('Only parts in this assembly (and joints touching them), e.g. W3. Default: the whole project.'),
  limit: z.number().int().min(1).max(30).default(8).describe('How many of the most loaded parts and joints to list. Default 8.'),
});
export type CheckStructureInput = z.output<typeof zCheckStructure>;

/** Parts the solver checks; the rest (mass only, ground, not connected) read 0. */
const CHECKED: ReadonlySet<PartResult['role']> = new Set(['member', 'truss', 'panel']);

export const percent = (u: number) => `${Math.round(u * 100)}%`;
const governed = (g: Governing | undefined) => (g ? `${g.check} under ${g.combo}` : 'not checked');

function loadText(project: Project, key: DesignLoadKey, v: SourcedValue): string {
  const override = project.site.designLoads[key];
  const source = override ? `yours: ${override.source}` : v.source;
  return `${formatLoad(key, v.value)} (${source})`;
}

function partRow(project: Project, r: PartResult): string {
  const label = partLabel(project, r.id) ?? r.id;
  return `${r.id} ${label} · ${percent(r.utilization)} · ${governed(r.governing)}`;
}

function jointRow(project: Project, r: JointResult): string {
  const joint = project.joints[r.id];
  const between = joint ? ` (${joint.partIds.join(' ↔ ')})` : '';
  return `${r.id}${between} · ${percent(r.utilization)} · ${governed(r.governing)}`;
}

const byLoad = <T extends { id: string; utilization: number }>(a: T, b: T) => b.utilization - a.utilization || compareIds(a.id, b.id);

/** The parts and joints in scope: all, or one assembly's parts and the joints touching them. */
function scoped(project: Project, result: AnalysisResult, assembly: string | undefined) {
  const parts = Object.values(result.parts).filter((r) => CHECKED.has(r.role) && (!assembly || project.parts[r.id]?.assemblyId === assembly));
  const ids = new Set(parts.map((p) => p.id));
  const joints = Object.values(result.joints).filter(
    (r) => r.governing !== undefined && (!assembly || (project.joints[r.id]?.partIds ?? []).some((id) => ids.has(id))),
  );
  return { parts: parts.sort(byLoad), joints: joints.sort(byLoad) };
}

export interface StructureReportOptions {
  assembly?: string;
  limit?: number;
}

/** The check_structure result text. */
export function formatStructureReport(project: Project, result: AnalysisResult, opts: StructureReportOptions = {}): string {
  const limit = opts.limit ?? 8;
  const L = result.loads;
  const lines = [STRUCTURE_DISCLAIMER];
  lines.push(
    `Loads: ground snow ${loadText(project, 'groundSnow', L.groundSnow)} · roof snow ${Number((L.roofSnow.value / KPA_PER_PSF).toFixed(1))} psf · wind ${loadText(project, 'windSpeed', L.windSpeed)}`,
  );

  if (result.status === 'mechanism') {
    lines.push(`Status: a mechanism, so nothing could be checked. ${result.mechanism?.message ?? ''}`.trim());
    return lines.join('\n');
  }
  if (result.unstable.length > 0) {
    lines.push(`Status: ${result.unstable.length} unstable: ${result.unstable.map((u) => u.message).join(' ')}`);
  } else {
    lines.push('Status: stands up; nothing unstable.');
  }

  const { parts, joints } = scoped(project, result, opts.assembly);
  if (opts.assembly) lines.push(`Scope: ${opts.assembly} (${parts.length} checked parts, ${joints.length} joints).`);
  const worst = parts[0];
  lines.push(worst ? `Most loaded: ${partRow(project, worst)}` : 'Most loaded: nothing checked here.');

  const overParts = parts.filter((p) => p.utilization > 1);
  const overJoints = joints.filter((j) => j.utilization > 1);
  if (overParts.length + overJoints.length === 0) {
    lines.push('Over the limit: nothing.');
  } else {
    lines.push(`Over the limit: ${overParts.length} part${overParts.length === 1 ? '' : 's'}, ${overJoints.length} joint${overJoints.length === 1 ? '' : 's'}.`);
    for (const p of overParts.slice(0, 30)) lines.push(`- ${partRow(project, p)}`);
    for (const j of overJoints.slice(0, 30)) lines.push(`- ${jointRow(project, j)}`);
  }

  lines.push(`Top ${Math.min(limit, parts.length)} parts:`);
  for (const p of parts.slice(0, limit)) lines.push(`- ${partRow(project, p)}`);
  if (joints.length > 0) {
    lines.push(`Top ${Math.min(limit, joints.length)} joints:`);
    for (const j of joints.slice(0, limit)) lines.push(`- ${jointRow(project, j)}`);
  }
  for (const w of result.warnings.slice(0, 5)) lines.push(`Note: ${w}`);
  return lines.join('\n');
}

// ── The stress view note ────────────────────────────────────────────────────

/** What the stress view shows when the person turns it on, for the automatic turn. */
export interface StressContext {
  /** The most loaded checked part. */
  worst: { id: string; label: string; utilization: number; check: string; combo: string } | null;
  /** Parts over 100%. */
  overCount: number;
  /** Unstable assemblies, or a mechanism. */
  unstable: string[];
}

/** The stress context for a result, over all checked parts (or the visible ones). */
export function stressContextOf(project: Project, result: AnalysisResult, isVisible: (partId: string) => boolean = () => true): StressContext {
  const parts = Object.values(result.parts)
    .filter((r) => CHECKED.has(r.role) && isVisible(r.id))
    .sort(byLoad);
  const w = parts[0];
  const unstable = result.status === 'mechanism' ? [result.mechanism?.message ?? 'The model is a mechanism.'] : result.unstable.map((u) => u.message);
  return {
    worst:
      w && w.governing
        ? { id: w.id, label: partLabel(project, w.id) ?? w.id, utilization: w.utilization, check: w.governing.check, combo: w.governing.combo }
        : null,
    overCount: parts.filter((p) => p.utilization > 1).length,
    unstable,
  };
}

const escape = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The `<stress_view>` block Claude reads at the start of the automatic turn. */
export function stressViewText(ctx: StressContext): string {
  const bits = ['The person just turned on the stress view.'];
  if (ctx.worst) {
    const w = ctx.worst;
    bits.push(`Most loaded: ${w.label} (${w.id}) at ${percent(w.utilization)} of its limit (${w.check} under ${w.combo}).`);
  }
  if (ctx.overCount > 0) bits.push(`${ctx.overCount} part${ctx.overCount === 1 ? ' is' : 's are'} over the limit.`);
  if (ctx.unstable.length > 0) bits.push(`Unstable: ${ctx.unstable.join(' ')}`);
  bits.push(STRUCTURE_DISCLAIMER);
  return `<stress_view>${escape(bits.join(' '))}</stress_view>`;
}
