/**
 * Site context (the house next door, a pool, trees) is drawn stippled, not solid
 * (ADR-0003 §A): a dot pattern on each face in `dot`, with faint edges. It isn't lit, casts
 * no shadows and can't be picked (an accidental tap on the neighbour's house shouldn't
 * select it on a phone).
 */
import { useEffect, useMemo } from 'react';
import { BoxGeometry, Color, EdgesGeometry, ShaderMaterial, DoubleSide, LineBasicMaterial, type Matrix4 } from 'three';
import type { Part } from '@slapdash/core';
import { SCENE_COLORS } from '../styles/tokens.ts';
import { partMatrix } from './batches.ts';

/** Dot spacing on the faces, mm. */
export const STIPPLE_PITCH_MM = 150;

const vertexShader = /* glsl */ `
uniform vec3 uSizeMm;
varying vec2 vFace;
void main() {
  vec3 p = position * uSizeMm;
  vec3 n = abs(normal);
  vFace = n.x > 0.5 ? p.zy : (n.y > 0.5 ? p.xz : p.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uDot;
uniform float uPitch;
varying vec2 vFace;
void main() {
  vec2 cell = (fract(vFace / uPitch + 0.5) - 0.5) * uPitch;
  float d = length(cell);
  float px = max(length(fwidth(vFace)) * 0.7071, 1e-6);
  float r = max(1.1 * px, uPitch * 0.06);
  float a = 1.0 - smoothstep(r - px * 0.5, r + px * 0.5, d);
  a *= smoothstep(3.0, 6.0, uPitch / px);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uDot, a);
  #include <colorspace_fragment>
}
`;

const unitBox = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
const unitEdges = new EdgesGeometry(unitBox);

function StippledPart({ part }: { part: Part }) {
  const matrix = useMemo<Matrix4>(() => partMatrix(part), [part]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uSizeMm: { value: [part.size.length, part.size.width, part.size.height] },
          uDot: { value: new Color(SCENE_COLORS.dot) },
          uPitch: { value: STIPPLE_PITCH_MM },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [part],
  );
  const edgeMaterial = useMemo(
    () => new LineBasicMaterial({ color: SCENE_COLORS.dot, transparent: true, opacity: 0.8, toneMapped: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => edgeMaterial.dispose(), [edgeMaterial]);
  return (
    <group matrix={matrix} matrixAutoUpdate={false} name={`context:${part.id}`}>
      <mesh geometry={unitBox} material={material} raycast={() => null} renderOrder={1} />
      <lineSegments geometry={unitEdges} material={edgeMaterial} raycast={() => null} />
    </group>
  );
}

export function SiteContext({ parts }: { parts: readonly Part[] }) {
  return (
    <group name="site-context">
      {parts.map((p) => (
        <StippledPart key={p.id} part={p} />
      ))}
    </group>
  );
}
