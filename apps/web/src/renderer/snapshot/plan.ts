/**
 * What a snapshot draws: the image size, the tiles and each tile's camera frame. Pure (no
 * Three.js objects), so the layout can be tested without WebGL.
 */
import type { Aabb, Project, Vec3 } from '@slapdash/core';
import { framingBounds, partAabb, unionAabb } from '../bounds.ts';
import { fitBounds, orthoFrame, presetDirection, upFor, viewAspect, type OrthoFrame, type PresetAngle } from '../camera.ts';
import { aabbToM } from '../units.ts';
import { sheetLayout, type Rect } from './compose.ts';
import type { SnapshotRequest } from './types.ts';

export const SNAPSHOT_FOV = 35;

export type TileCamera =
  | ({ kind: 'ortho' } & OrthoFrame)
  | { kind: 'perspective'; fov: number; aspect: number; position: Vec3; target: Vec3; up: Vec3; near: number; far: number };

export interface TilePlan {
  caption: string | null;
  rect: Rect;
  camera: TileCamera;
  /** Draw the north arrow (plan views). */
  north: boolean;
}

export interface SnapshotPlan {
  width: number;
  height: number;
  tiles: TilePlan[];
  angle: string;
}

function orthoCamera(box: Aabb, angle: PresetAngle, aspect: number): TileCamera {
  return { kind: 'ortho', ...orthoFrame(box, presetDirection(angle), aspect, 0.05) };
}

function perspectiveCamera(box: Aabb, aspect: number): TileCamera {
  const dir = presetDirection('iso');
  const fit = fitBounds(box, dir, SNAPSHOT_FOV, aspect, 1.02);
  return {
    kind: 'perspective',
    fov: SNAPSHOT_FOV,
    aspect,
    position: fit.position,
    target: fit.target,
    up: upFor(dir),
    near: Math.max(0.01, fit.distance / 500),
    far: fit.distance * 20 + 100,
  };
}

/** The AABB (mm) of a part, or of all parts of an assembly. */
export function idBounds(project: Project, id: string): Aabb | null {
  const part = project.parts[id];
  if (part) return partAabb(part);
  return unionAabb(Object.values(project.parts).filter((p) => p.assemblyId === id).map(partAabb));
}

export function planSnapshot(req: SnapshotRequest, project: Project): SnapshotPlan {
  const box = aabbToM(framingBounds(project));
  const size = req.size;

  if (req.angle === 'sheet') {
    const tiles = sheetLayout(size).map((t): TilePlan => ({
      caption: t.caption,
      rect: t.rect,
      north: t.id === 'top',
      camera: t.id === 'iso' ? perspectiveCamera(box, 1) : orthoCamera(box, t.id, 1),
    }));
    const edge = Math.floor(size / 2) * 2;
    return { width: edge, height: edge, tiles, angle: 'sheet' };
  }

  if (typeof req.angle === 'object') {
    const target = idBounds(project, req.angle.frame);
    const framed = target ? aabbToM(target) : box;
    const aspect = viewAspect(framed, presetDirection('iso'));
    const { width, height } = fitSize(size, aspect);
    return {
      width,
      height,
      angle: `frame ${req.angle.frame}`,
      tiles: [{ caption: null, rect: { x: 0, y: 0, w: width, h: height }, north: false, camera: perspectiveCamera(framed, width / height) }],
    };
  }

  const angle = req.angle;
  const aspect = viewAspect(box, presetDirection(angle));
  const { width, height } = fitSize(size, aspect);
  return {
    width,
    height,
    angle,
    tiles: [
      {
        caption: null,
        rect: { x: 0, y: 0, w: width, h: height },
        north: angle === 'top',
        camera: angle === 'iso' ? perspectiveCamera(box, width / height) : orthoCamera(box, angle, width / height),
      },
    ],
  };
}

/** Long edge = `size`, the other from the aspect (width / height). */
export function fitSize(size: number, aspect: number): { width: number; height: number } {
  return aspect >= 1 ? { width: size, height: Math.round(size / aspect) } : { width: Math.round(size * aspect), height: size };
}
