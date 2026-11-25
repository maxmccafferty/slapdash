/**
 * Orange means selected or being worked on (ADR-0003 §A), and it is used for outlines
 * only, never fill: solid box edges for the pointed-at part and for parts in progress, and
 * a dashed box for a proposed structure. Drawn without depth test, so an outline behind a
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

export interface HighlightsProps {
  parts: readonly Part[];
  proposal: Proposal | null;
}

export function Highlights({ parts, proposal }: HighlightsProps) {
  const solid = useMemo(() => partEdgeSegments(parts), [parts]);
  const dashed = useMemo(() => (proposal ? proposalSegments(proposal) : null), [proposal]);
  return (
    <group name="highlights">
      {solid.length > 0 && (
        <Line
          name="outline"
          points={solid}
          segments
          lineWidth={2}
          color={SCENE_COLORS.signal}
          depthTest={false}
          transparent
          renderOrder={10}
          raycast={() => null}
        />
      )}
      {dashed && (
        <Line
          name="proposal"
          points={dashed}
          segments
          dashed
          dashSize={0.25}
          gapSize={0.15}
          lineWidth={2}
          color={SCENE_COLORS.signal}
          depthTest={false}
          transparent
          renderOrder={10}
          raycast={() => null}
        />
      )}
    </group>
  );
}
