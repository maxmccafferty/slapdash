/**
 * The compass lies on the floor near its front (south-east) corner, the corner nearest the
 * default view: a dotted ring, a solid arrow to north (−z) and N E S W.
 * It is part of the scene, so it turns with the model. About 4 ft across, so the letters
 * stay legible on a phone (HANDOFF "Not designed").
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { MM_PER_FOOT } from '@slapdash/core';
import { SCENE_COLORS } from '../styles/tokens.ts';
import type { FloorBounds } from './bounds.ts';
import { LABEL_FONT_FAMILY, get2d, whenFontsReady } from './labels.ts';
import { mmToM } from './units.ts';

const SIZE = 1024;
export const COMPASS_DIAMETER_MM = 4 * MM_PER_FOOT;
/** Inset of the compass centre from the floor's south-east corner, on both axes. */
const INSET_MM = 4 * MM_PER_FOOT;

function drawCompass(canvas: HTMLCanvasElement): boolean {
  const ctx = get2d(canvas);
  if (!ctx) return false;
  const c = SIZE / 2;
  const ring = SIZE * 0.34;
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Dotted ring.
  ctx.fillStyle = SCENE_COLORS.muted;
  const dots = 48;
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * ring, c + Math.sin(a) * ring, SIZE * 0.008, 0, Math.PI * 2);
    ctx.fill();
  }

  // Solid arrow to north (up in the texture is −z in the scene).
  ctx.fillStyle = SCENE_COLORS.ink;
  ctx.beginPath();
  ctx.moveTo(c, c - ring * 0.92);
  ctx.lineTo(c + SIZE * 0.05, c + SIZE * 0.02);
  ctx.lineTo(c, c - SIZE * 0.02);
  ctx.lineTo(c - SIZE * 0.05, c + SIZE * 0.02);
  ctx.closePath();
  ctx.fill();

  ctx.font = `600 ${SIZE * 0.11}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = SIZE * 0.44;
  ctx.fillStyle = SCENE_COLORS.ink;
  ctx.fillText('N', c, c - r);
  ctx.fillStyle = SCENE_COLORS.muted;
  ctx.fillText('S', c, c + r);
  ctx.fillText('E', c + r, c);
  ctx.fillText('W', c - r, c);
  return true;
}

/** Centre of the compass, on the floor 4 ft in from its south-east corner on both axes (mm). */
export function compassCentreMm(bounds: FloorBounds): { x: number; z: number } {
  return { x: bounds.maxX - INSET_MM, z: bounds.maxZ - INSET_MM };
}

export function Compass({ bounds }: { bounds: FloorBounds }) {
  const invalidate = useThree((s) => s.invalidate);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);

  useEffect(() => {
    let live = true;
    // Draw once now (fallback font), then again once Geist has loaded.
    if (drawCompass(texture.image as HTMLCanvasElement)) texture.needsUpdate = true;
    void whenFontsReady().then(() => {
      if (!live) return;
      if (drawCompass(texture.image as HTMLCanvasElement)) {
        texture.needsUpdate = true;
        invalidate();
      }
    });
    return () => {
      live = false;
      texture.dispose();
    };
  }, [texture, invalidate]);

  const c = compassCentreMm(bounds);
  const x = mmToM(c.x);
  const z = mmToM(c.z);
  const d = mmToM(COMPASS_DIAMETER_MM);
  return (
    <mesh name="compass" position={[x, 0.004, z]} rotation-x={-Math.PI / 2} raycast={() => null} renderOrder={2}>
      <planeGeometry args={[d, d]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
