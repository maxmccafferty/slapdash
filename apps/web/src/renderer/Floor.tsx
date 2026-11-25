/**
 * The bounded floor (ADR-0003 §A): `floor` with a dot grid at 1 ft in `dot`, a hairline
 * border, and a shadow catcher on top so shadows read without greying the floor. Dots are
 * anti-aliased in screen space and fade out when they would crowd together.
 */
import { useMemo } from 'react';
import { BufferGeometry, Color, Float32BufferAttribute, ShaderMaterial } from 'three';
import { SCENE_COLORS } from '../styles/tokens.ts';
import type { FloorBounds } from './bounds.ts';
import { FOOT_M, mmToM } from './units.ts';

const vertexShader = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uFloor;
uniform vec3 uDot;
uniform float uPitch;
uniform float uRadiusPx;
varying vec2 vWorld;
void main() {
  vec2 cell = (fract(vWorld / uPitch + 0.5) - 0.5) * uPitch;
  float d = length(cell);
  float px = max(length(fwidth(vWorld)) * 0.7071, 1e-6);
  float r = uRadiusPx * px;
  float dotMask = 1.0 - smoothstep(r - px * 0.5, r + px * 0.5, d);
  // Fade the grid out when dots would be closer than ~5 px.
  float spacingPx = uPitch / px;
  dotMask *= smoothstep(5.0, 10.0, spacingPx);
  gl_FragColor = vec4(mix(uFloor, uDot, dotMask), 1.0);
  #include <colorspace_fragment>
}
`;

export function Floor({ bounds }: { bounds: FloorBounds }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uFloor: { value: new Color(SCENE_COLORS.floor) },
          uDot: { value: new Color(SCENE_COLORS.dot) },
          uPitch: { value: FOOT_M },
          uRadiusPx: { value: 1.2 },
        },
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      }),
    [],
  );

  const minX = mmToM(bounds.minX);
  const maxX = mmToM(bounds.maxX);
  const minZ = mmToM(bounds.minZ);
  const maxZ = mmToM(bounds.maxZ);
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const border = useMemo(() => {
    const g = new BufferGeometry();
    const y = 0.001;
    g.setAttribute(
      'position',
      new Float32BufferAttribute([minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ], 3),
    );
    return g;
  }, [minX, maxX, minZ, maxZ]);

  return (
    <group name="floor">
      <mesh material={material} position={[cx, -0.002, cz]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh position={[cx, -0.001, cz]} rotation-x={-Math.PI / 2} receiveShadow raycast={() => null}>
        <planeGeometry args={[w, d]} />
        <shadowMaterial opacity={0.18} transparent depthWrite={false} />
      </mesh>
      <lineLoop geometry={border} raycast={() => null}>
        <lineBasicMaterial color={SCENE_COLORS.ink} transparent opacity={0.25} toneMapped={false} />
      </lineLoop>
    </group>
  );
}
