/**
 * Dimension lines (ADR-0003 §C): ink hairlines with extension lines and slash ticks, and a
 * feet-and-inch label at the middle. Labels are screen-sized sprites (14 px) drawn on top.
 */
import { Line } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { SpriteMaterial } from 'three';
import type { Vec3 } from '@slapdash/core';
import { SCENE_COLORS } from '../styles/tokens.ts';
import type { DimensionLine } from './dimensions.ts';
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

function DimensionLabel({ text, position }: { text: string; position: V3 }) {
  const label = useMemo(() => makeLabelTexture(text), [text]);
  const material = useMemo(
    () => new SpriteMaterial({ map: label.texture, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }),
    [label],
  );
  useEffect(
    () => () => {
      material.dispose();
      label.texture.dispose();
    },
    [material, label],
  );
  const screenSize: ScreenSize = { widthPx: label.widthPx, heightPx: label.heightPx };
  return <sprite material={material} position={position} renderOrder={20} userData={{ screenSize }} raycast={() => null} />;
}

export function Dimensions({ lines }: { lines: readonly DimensionLine[] }) {
  const segments = useMemo(() => lines.flatMap(dimensionSegments), [lines]);
  if (lines.length === 0) return null;
  return (
    <group name="dimensions">
      <Line points={segments} segments lineWidth={1} color={SCENE_COLORS.ink} depthTest={false} renderOrder={15} raycast={() => null} />
      {lines.map((l) => {
        const mid = mul(add(vecToM(l.from), vecToM(l.to)), 0.5);
        const p = add(mid, vecToM(l.offset));
        return <DimensionLabel key={`${l.id}:${l.label}`} text={l.label} position={tuple(p)} />;
      })}
    </group>
  );
}
