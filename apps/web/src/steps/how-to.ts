/**
 * The Build steps panel's copy: a short how-to for each step, in a builder's voice, and a
 * one-line count of what the step builds.
 */
import type { BuildStepGroup, Project, StepKey } from '@slapdash/core';

export const STEP_HOW_TO: Record<StepKey, string> = {
  slab: 'Form the edges, lay gravel and vapour barrier, set the anchor bolts, pour and float. Let it cure a week before framing.',
  foundation: 'Dig the footings below the frost line, set the forms and rebar, pour, then set the anchor bolts while the concrete is wet.',
  floor: 'Bolt the sill plates down, set the beams and joists at their spacing, add blocking, then glue and nail the subfloor.',
  walls: 'Frame each wall flat on the slab: plates, studs at 16″, headers over openings. Stand, plumb and brace, then nail the corners and add the top plate.',
  roof: 'Set the ridge, cut and fit rafters at the pitch, add hurricane ties, sheathe, then underlayment and roofing.',
  fence: 'Set the posts in concrete on a string line, let them cure, then hang the rails and fix the boards.',
  deck: 'Pour the piers below the frost line, set the posts and beams, hang the joists at their spacing, then screw the decking down with even gaps. Add the guard and stairs last.',
  pergola: 'Pour the piers, stand and brace the posts, bolt the doubled beams to them, then set the rafters with ties. Add purlins and roofing panels if it has a roof.',
  structures: 'Set these pieces once the main build is up, following their own instructions.',
  other: 'Items placed by hand: pipe, wire, fixtures and finishes. Plan them with the trade that installs them.',
  site: 'Clear and level the site, and mark the corners before anything else.',
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** "4 walls, 2 openings, 96 parts": the assemblies a step builds, then its part count. */
export function stepFacts(project: Project, group: BuildStepGroup): string {
  const assemblies = new Map<string, number>();
  const seen = new Set<string>();
  for (const id of group.partIds) {
    const assemblyId = project.parts[id]?.assemblyId;
    if (!assemblyId || seen.has(assemblyId)) continue;
    seen.add(assemblyId);
    const kind = project.assemblies[assemblyId]?.kind;
    if (kind) assemblies.set(kind, (assemblies.get(kind) ?? 0) + 1);
  }
  const bits: string[] = [];
  const walls = assemblies.get('wall');
  const openings = assemblies.get('opening');
  if (walls) bits.push(plural(walls, 'wall'));
  if (openings) bits.push(plural(openings, 'opening'));
  bits.push(plural(group.partIds.length, 'part'));
  return bits.join(', ');
}
