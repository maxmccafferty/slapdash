/**
 * The scene itself: part batches, site context, floor, compass, lights, dimensions and
 * highlights. It is parameterised by a `ViewSpec`, so the user's view and a snapshot are the
 * same component with different props (and a different `CutUniforms`).
 */
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { CatalogIndex, Part, Project, StepKey } from '@slapdash/core';
import type { Proposal } from '../state/model-store.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';
import { groupParts, type Batch } from './batches.ts';
import { floorBounds, isContextPart } from './bounds.ts';
import { Compass } from './Compass.tsx';
import { setCut, type CutUniforms } from './CutFaces.ts';
import { Dimensions } from './Dimensions.tsx';
import type { EntranceSchedule } from './entrances.ts';
import { dimensionSet } from './dimensions.ts';
import { clipBelow, partEdgeSegments, type V3 } from './edges.ts';
import { Floor } from './Floor.tsx';
import { Highlights } from './Highlights.tsx';
import { Lighting } from './Lighting.tsx';
import { sceneMaterials, setCutSide } from './materials.ts';
import { PartBatch } from './PartBatch.tsx';
import { TIER_SETTINGS, type QualityTier } from './quality.ts';
import { SiteContext } from './SiteContext.tsx';
import type { SceneMode } from './snapshot/types.ts';
import type { StressBand } from '../analysis/stress.ts';
import { StressCallout, StressMarks } from './StressCallout.tsx';
import { cutPlaneFor, isCuttable, isPartVisible, type FloorId, type LookFrom } from './visibility.ts';

/** The stress overlay: each part's band and the callout on the most loaded visible part. */
export interface StressSpec {
  bands: ReadonlyMap<string, StressBand>;
  callout: { partId: string; text: string; over: boolean } | null;
}

export interface ViewSpec {
  mode: SceneMode;
  /** With mode "stress": the bands and the callout. */
  stress?: StressSpec | null;
  floor: FloorId;
  lookFrom: LookFrom;
  /** The build steps shown while Build steps is open; absent or null shows the whole build. */
  steps?: ReadonlySet<StepKey> | null;
  dimensions: boolean;
  /** Part ids outlined strongly in orange: the user's selection, or a snapshot's highlights. */
  outlined: readonly string[];
  /** Part ids Claude is working on: a lighter orange outline where they are landing. */
  inProgress?: Iterable<string>;
  proposal: Proposal | null;
}

export interface SceneContentProps {
  project: Project;
  catalog: CatalogIndex | null;
  spec: ViewSpec;
  cut: CutUniforms;
  tier: QualityTier;
  /** The user's view only: new parts fall and fade in, and their dimensions wait for them. */
  entrances?: EntranceSchedule | null;
}

/** Ink edges for blueprint and x-ray snapshots, clipped by the Inside cut. */
function BatchEdges({ parts, isCuttable: cuttable, cutY, opacity }: { parts: readonly Part[]; isCuttable: (p: Part) => boolean; cutY: number | null; opacity: number }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (const part of parts) {
      const segs = partEdgeSegments([part]);
      for (let i = 0; i < segs.length; i += 2) {
        const seg: [V3, V3] | null = cutY !== null && cuttable(part) ? clipBelow(segs[i]!, segs[i + 1]!, cutY) : [segs[i]!, segs[i + 1]!];
        if (seg) positions.push(...seg[0], ...seg[1]);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return g;
  }, [parts, cuttable, cutY]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={() => null} renderOrder={5}>
      <lineBasicMaterial color={SCENE_COLORS.ink} transparent={opacity < 1} opacity={opacity} toneMapped={false} />
    </lineSegments>
  );
}

export function SceneContent({ project, catalog, spec, cut, tier, entrances = null }: SceneContentProps) {
  const invalidate = useThree((s) => s.invalidate);
  const previous = useRef<Batch[]>([]);
  const batches = useMemo(() => (previous.current = groupParts(project, previous.current)), [project]);

  const vis = useMemo(
    () => ({ floor: spec.floor, lookFrom: spec.lookFrom, steps: spec.steps ?? null }),
    [spec.floor, spec.lookFrom, spec.steps],
  );
  const isVisible = useMemo(() => {
    const cache = new Map<string, boolean>();
    return (part: Part) => {
      let v = cache.get(part.assemblyId);
      if (v === undefined) cache.set(part.assemblyId, (v = isPartVisible(part, project.assemblies[part.assemblyId], vis)));
      return v;
    };
  }, [project.assemblies, vis]);
  const cuttable = useMemo(
    () => (part: Part) => {
      const kind = project.assemblies[part.assemblyId]?.kind;
      return kind ? isCuttable(kind) : false;
    },
    [project.assemblies],
  );

  const cutMm = cutPlaneFor(spec.lookFrom, project.levels);
  const cutY = cutMm === null ? null : cutMm / 1000;
  useLayoutEffect(() => {
    if (setCut(cut, cutY)) invalidate();
  }, [cut, cutY, invalidate]);
  // Inside needs back faces (the dark cut faces). Materials made later pick it up on the next render.
  useLayoutEffect(() => {
    setCutSide(sceneMaterials(cut), cutY !== null);
  });

  // Filtered member lists are cached per Batch object, so an unchanged batch keeps the same
  // array and its (memoised) PartBatch doesn't re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new isVisible must drop the cache.
  const filtered = useMemo(() => new WeakMap<Batch, Part[]>(), [isVisible]);
  const visibleParts = (b: Batch): Part[] => {
    let list = filtered.get(b);
    if (!list) filtered.set(b, (list = b.parts.filter(isVisible)));
    return list;
  };
  const context = useMemo(() => Object.values(project.parts).filter((p) => isContextPart(p) && isVisible(p)), [project.parts, isVisible]);
  const bounds = floorBounds(project);
  const lines = useMemo(() => (spec.dimensions ? dimensionSet(project, isVisible) : []), [spec.dimensions, project, isVisible]);
  const outlinedParts = useMemo(
    () => spec.outlined.map((id) => project.parts[id]).filter((p): p is Part => !!p && isVisible(p)),
    [spec.outlined, project.parts, isVisible],
  );
  const inProgressParts = useMemo(() => {
    const strong = new Set(spec.outlined);
    return [...(spec.inProgress ?? [])].filter((id) => !strong.has(id)).map((id) => project.parts[id]).filter((p): p is Part => !!p && isVisible(p));
  }, [spec.outlined, spec.inProgress, project.parts, isVisible]);
  const settings = TIER_SETTINGS[tier];

  return (
    <>
      <Lighting bounds={bounds} location={project.site.location} shadowMapSize={settings.shadowMapSize} shadows={spec.mode === 'textured'} />
      <Floor bounds={bounds} />
      <Compass bounds={bounds} />
      <group name="parts">
        {batches.map((b) => (
          <PartBatch
            key={b.key}
            batch={b}
            parts={visibleParts(b)}
            isCuttable={cuttable}
            mode={spec.mode}
            {...(spec.mode === 'stress' && spec.stress ? { stress: spec.stress.bands } : {})}
            tier={tier}
            cut={cut}
            catalog={catalog}
            entrances={entrances}
          />
        ))}
      </group>
      {spec.mode !== 'textured' &&
        spec.mode !== 'stress' &&
        batches.map((b) => (
          <BatchEdges
            key={`edges:${b.key}`}
            parts={visibleParts(b)}
            isCuttable={cuttable}
            cutY={cutY}
            opacity={spec.mode === 'xray' ? 0.5 : 1}
          />
        ))}
      <SiteContext parts={context} />
      {spec.dimensions && <Dimensions lines={lines} entrances={entrances} />}
      <Highlights selected={outlinedParts} inProgress={inProgressParts} proposal={spec.proposal} />
      {spec.mode === 'stress' && spec.stress && (
        <>
          <StressMarks project={project} bands={spec.stress.bands} isVisible={isVisible} exclude={spec.stress.callout?.partId ?? null} />
          {spec.stress.callout && project.parts[spec.stress.callout.partId] && (
            <StressCallout part={project.parts[spec.stress.callout.partId]!} text={spec.stress.callout.text} over={spec.stress.callout.over} />
          )}
        </>
      )}
    </>
  );
}
