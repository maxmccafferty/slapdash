/**
 * Dimension lines (ADR-0003 §C): ink hairlines with extension lines and slash ticks, and a
 * feet-and-inch label at the middle. Labels are screen-sized sprites (14 px) drawn on top.
 *
 * A measurement that appears with new parts (a build) waits until they have landed, then
 * fades in (`entrances.ts`); opacity is set in `useFrame`, so nothing re-renders per frame.
 */
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import { SpriteMaterial, type Object3D } from 'three';
import type { Vec3 } from '@slapdash/core';
import { SCENE_COLORS } from '../styles/tokens.ts';
import type { DimensionLine } from './dimensions.ts';
import { labelOpacity, type EntranceSchedule } from './entrances.ts';
import { makeLabelTexture, type ScreenSize } from './labels.ts';
import { vecToM } from './units.ts';

const TICK_M = 0.12;
/** How far extension lines run past the dimension line. */
const OVERSHOOT_M = 0.08;

type V3 = [number, number, number];

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const tuple = (v: Vec3): V3 => [v.x, v.y, v.z];

/** Segment endpoints (pairs) for one dimension, in metres. */
export function dimensionSegments(line: DimensionLine): V3[] {
  const from = vecToM(line.from);
  const to = vecToM(line.to);
  const offset = vecToM(line.offset);
  const a = add(from, offset);
  const b = add(to, offset);
  const out: V3[] = [tuple(a), tuple(b)];
  const off = unit(offset);
  // Extension lines from the measured points, a little past the dimension line.
  out.push(tuple(add(from, mul(off, 0.05))), tuple(add(a, mul(off, OVERSHOOT_M))));
  out.push(tuple(add(to, mul(off, 0.05))), tuple(add(b, mul(off, OVERSHOOT_M))));
  // Architectural slash ticks at both ends.
  const slash = mul(unit(add(unit(sub(b, a)), off)), TICK_M / 2);
  for (const p of [a, b]) out.push(tuple(sub(p, slash)), tuple(add(p, slash)));
  return out;
}

function DimensionLabel({ text, position, material }: { text: string; position: V3; material: SpriteMaterial }) {
  const label = useMemo(() => makeLabelTexture(text), [text]);
  useLayoutEffect(() => {
    material.map = label.texture;
    material.needsUpdate = true;
  }, [material, label]);
  useEffect(() => () => label.texture.dispose(), [label]);
  const screenSize: ScreenSize = { widthPx: label.widthPx, heightPx: label.heightPx };
  return <sprite material={material} position={position} renderOrder={20} userData={{ screenSize }} raycast={() => null} />;
}

/** One measurement: its line, extension lines, ticks and label. */
function Dimension({ line, entrances }: { line: DimensionLine; entrances: EntranceSchedule | null }) {
  const segments = useMemo(() => dimensionSegments(line), [line]);
  const position = useMemo(() => tuple(add(mul(add(vecToM(line.from), vecToM(line.to)), 0.5), vecToM(line.offset))), [line]);
  const material = useMemo(() => new SpriteMaterial({ depthTest: false, depthWrite: false, toneMapped: false, transparent: true }), []);
  useEffect(() => () => material.dispose(), [material]);
  const group = useRef<Object3D>(null);
  const lineRef = useRef<ComponentRef<typeof Line>>(null);
  const mountedAt = useRef(0);
  const done = useRef(entrances === null);
  useLayoutEffect(() => {
    mountedAt.current = performance.now();
  }, []);
  useFrame((state) => {
    if (done.current || !entrances) return;
    const opacity = labelOpacity(entrances, mountedAt.current, performance.now());
    material.opacity = opacity;
    const lm = lineRef.current?.material;
    if (lm) {
      lm.opacity = opacity;
      lm.transparent = true;
    }
    if (group.current) group.current.visible = opacity > 0;
    if (opacity >= 1) done.current = true;
    else state.invalidate();
  });
  return (
    <group ref={group}>
      <Line ref={lineRef} points={segments} segments lineWidth={1} color={SCENE_COLORS.ink} depthTest={false} renderOrder={15} raycast={() => null} />
      <DimensionLabel text={line.label} position={position} material={material} />
    </group>
  );
}

export function Dimensions({ lines, entrances = null }: { lines: readonly DimensionLine[]; entrances?: EntranceSchedule | null }) {
  if (lines.length === 0) return null;
  return (
    <group name="dimensions">
      {lines.map((l) => (
        <Dimension key={`${l.id}:${l.label}`} line={l} entrances={entrances} />
      ))}
    </group>
  );
}
