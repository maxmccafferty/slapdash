/**
 * The stress view's words on the model (ADR-0003 §C): one callout on the most loaded
 * visible part ("Header, South wall · about 90% of its limit"), a white unit with ink text
 * on a leader line, anchored at the top centre of the part; and a small ink warning mark
 * on each part over its limit (at most 20). No orange: orange stays the selection outline.
 */
import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { aabbOf, partBox, type Part, type Project } from '@slapdash/core';
import { Icon } from '../components/Icon.tsx';
import type { StressBand } from '../analysis/stress.ts';
import styles from './StressCallout.module.css';

export const MAX_STRESS_MARKS = 20;

/** Top centre of a part's bounds, in metres. */
export function topCentre(part: Part): [number, number, number] {
  const b = aabbOf(partBox(part));
  return [(b.min.x + b.max.x) / 2000, b.max.y / 1000, (b.min.z + b.max.z) / 2000];
}

export function StressCallout({ part, text, over }: { part: Part; text: string; over: boolean }) {
  const at = useMemo(() => topCentre(part), [part]);
  return (
    <group name="stress-callout" position={at} userData={{ partId: part.id, text, over }}>
      <Html zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className={styles.callout} data-testid="stress-callout" data-over={over ? 'true' : 'false'}>
          <span className={styles.label}>
            {over && (
              <span data-testid="stress-warning">
                <Icon name="warning" />
              </span>
            )}
            {text}
          </span>
          <span className={styles.leader} />
        </div>
      </Html>
    </group>
  );
}

/** Warning marks on over-limit visible parts (not the one with the callout). */
export function StressMarks({
  project,
  bands,
  isVisible,
  exclude,
}: {
  project: Project;
  bands: ReadonlyMap<string, StressBand>;
  isVisible: (part: Part) => boolean;
  exclude: string | null;
}) {
  const over = useMemo(() => {
    const out: Part[] = [];
    for (const [id, band] of bands) {
      if (band !== 'over' || id === exclude) continue;
      const part = project.parts[id];
      if (part && isVisible(part)) out.push(part);
      if (out.length >= MAX_STRESS_MARKS) break;
    }
    return out;
  }, [bands, project.parts, isVisible, exclude]);
  return (
    <group name="stress-marks" userData={{ partIds: over.map((p) => p.id) }}>
      {over.map((p) => (
        <group key={p.id} position={topCentre(p)}>
          <Html zIndexRange={[19, 10]} style={{ pointerEvents: 'none' }}>
            <span className={styles.mark} data-testid="stress-mark">
              <Icon name="warning" />
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}
