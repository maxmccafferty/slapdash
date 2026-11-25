/**
 * Light without network assets: the sun (suncalc, mid-afternoon at the site) with a shadow
 * camera fitted to the floor, a hemisphere fill, and a soft room environment (PMREM of
 * three's `RoomEnvironment`, no HDRI download) for reflections.
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { DirectionalLight, Object3D, PMREMGenerator, Scene, type Texture, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SiteLocation } from '@slapdash/core';
import { SCENE_COLORS } from '../styles/tokens.ts';
import type { FloorBounds } from './bounds.ts';
import { sunDirection } from './sun.ts';
import { mmToM } from './units.ts';

const environments = new WeakMap<WebGLRenderer, Texture | null>();

/** One prefiltered environment per renderer, shared by every scene. */
function roomEnvironment(gl: WebGLRenderer): Texture | null {
  if (environments.has(gl)) return environments.get(gl)!;
  let texture: Texture | null = null;
  try {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    texture = pmrem.fromScene(room as unknown as Scene, 0.04).texture;
    room.dispose();
    pmrem.dispose();
  } catch {
    texture = null; // No real WebGL (tests): go without reflections.
  }
  environments.set(gl, texture);
  return texture;
}

export interface LightingProps {
  bounds: FloorBounds;
  location: SiteLocation | undefined;
  shadowMapSize: number;
  shadows: boolean;
}

export function Lighting({ bounds, location, shadowMapSize, shadows }: LightingProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const env = roomEnvironment(gl);
    scene.environment = env;
    scene.environmentIntensity = 0.4;
    return () => {
      if (scene.environment === env) scene.environment = null;
    };
  }, [gl, scene]);

  const cx = mmToM((bounds.minX + bounds.maxX) / 2);
  const cz = mmToM((bounds.minZ + bounds.maxZ) / 2);
  const radius = mmToM(Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2);
  const dir = useMemo(() => sunDirection(location), [location]);
  const target = useMemo(() => new Object3D(), []);
  const distance = radius * 2 + 10;
  const sun = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    sun.current?.shadow.camera.updateProjectionMatrix();
  });

  return (
    <>
      <hemisphereLight args={[SCENE_COLORS.paper, SCENE_COLORS.floor, 0.6]} />
      <primitive object={target} position={[cx, 0, cz]} />
      <directionalLight
        key={shadowMapSize}
        ref={sun}
        name="sun"
        target={target}
        position={[cx + dir.x * distance, dir.y * distance, cz + dir.z * distance]}
        intensity={2.5}
        castShadow={shadows}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={0.5}
        shadow-camera-far={distance * 2}
        shadow-bias={-0.0004}
        shadow-normalBias={0.015}
      />
    </>
  );
}
