/**
 * Orange means selected or being worked on (ADR-0003 §A), and it is used for outlines
 * only, never fill: solid box edges for the pointed-at part (full strength, 2px), lighter
 * thinner edges for parts in progress (where they will land), and a dashed box, also light,
 * for a proposed structure. Drawn without depth test, so an outline behind a
 * wall still reads.
 */
import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import type { Part } from '@slapdash/core';
import type { Proposal } from '../state/model-store.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';
import { BOX_EDGES, partEdgeSegments, type V3 } from './edges.ts';

/** The dashed box of a proposal, in metres. */
export function proposalSegments(p: Proposal): V3[] {
  const x0 = Math.min(p.footprint.from.x, p.footprint.to.x) / 1000;
  const x1 = Math.max(p.footprint.from.x, p.footprint.to.x) / 1000;
  const z0 = Math.min(p.footprint.from.z, p.footprint.to.z) / 1000;
  const z1 = Math.max(p.footprint.from.z, p.footprint.to.z) / 1000;
  const y0 = (p.base_mm ?? 0) / 1000;
  const y1 = y0 + p.height_mm / 1000;
  const c: V3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) c.push([x, y, z]);
  return BOX_EDGES.flatMap(([a, b]) => [c[a]!, c[b]!]);
}

/** The pointed-at part: full strength, so the selection reads at a glance. */
export const SELECTED_OUTLINE = { lineWidth: 2, opacity: 1 } as const;
/**
 * Parts Claude is working on (drawn where they will land while they fall) and the dashed
 * proposal box: thinner and see-through, so they guide without competing with the build.
 */
export const IN_PROGRESS_OUTLINE = { lineWidth: 1, opacity: 0.4 } as const;

export interface HighlightsProps {
  /** Outlined strongly: the user's selection, or a snapshot's highlights. */
  selected: readonly Part[];
  /** Outlined lightly: parts in progress. */
  inProgress?: readonly Part[];
  proposal: Proposal | null;
}

const common = { segments: true, color: SCENE_COLORS.signal, depthTest: false, depthWrite: false, transparent: true, renderOrder: 10, raycast: () => null } as const;

export function Highlights({ selected, inProgress = [], proposal }: HighlightsProps) {
  const strong = useMemo(() => partEdgeSegments(selected), [selected]);
  const light = useMemo(() => partEdgeSegments(inProgress), [inProgress]);
  const dashed = useMemo(() => (proposal ? proposalSegments(proposal) : null), [proposal]);
  return (
    <group name="highlights">
      {light.length > 0 && <Line name="outline-in-progress" points={light} {...common} {...IN_PROGRESS_OUTLINE} />}
      {strong.length > 0 && <Line name="outline" points={strong} {...common} {...SELECTED_OUTLINE} renderOrder={11} />}
      {dashed && <Line name="proposal" points={dashed} dashed dashSize={0.25} gapSize={0.15} {...common} {...IN_PROGRESS_OUTLINE} />}
    </group>
  );
}
