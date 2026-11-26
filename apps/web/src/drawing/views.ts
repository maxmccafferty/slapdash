/**
 * The five views on the sheet and how each projects the model (mm, y up, north = −z,
 * east = +x) onto the sheet (x right, y down). Elevations are drawn upright, as seen from
 * outside:
 *
 * - Plan: (x, z), so north is up.
 * - South (from +z looking north): (x, −y).
 * - North (from −z looking south): (−x, −y), so east is on the left.
 * - East (from +x looking west): (−z, −y), so north is on the right.
 * - West (from −x looking east): (z, −y).
 */
import type { Vec3 } from '@slapdash/core';

export type ViewId = 'plan' | 'north' | 'south' | 'east' | 'west';
export type ElevationId = Exclude<ViewId, 'plan'>;

export const ELEVATIONS: readonly ElevationId[] = ['north', 'south', 'east', 'west'];

export interface P2 {
  x: number;
  y: number;
}

export interface ViewDef {
  id: ViewId;
  project: (v: Vec3) => P2;
  /** Unit vector from the model toward the viewer. */
  towardViewer: Vec3;
}

export const VIEWS: Record<ViewId, ViewDef> = {
  plan: { id: 'plan', project: (v) => ({ x: v.x, y: v.z }), towardViewer: { x: 0, y: 1, z: 0 } },
  south: { id: 'south', project: (v) => ({ x: v.x, y: -v.y }), towardViewer: { x: 0, y: 0, z: 1 } },
  north: { id: 'north', project: (v) => ({ x: -v.x, y: -v.y }), towardViewer: { x: 0, y: 0, z: -1 } },
  east: { id: 'east', project: (v) => ({ x: -v.z, y: -v.y }), towardViewer: { x: 1, y: 0, z: 0 } },
  west: { id: 'west', project: (v) => ({ x: v.z, y: -v.y }), towardViewer: { x: -1, y: 0, z: 0 } },
};

export const VIEW_NAMES: Record<ElevationId, string> = { north: 'North', south: 'South', east: 'East', west: 'West' };

/** Distance from the viewer, up to a constant: larger is farther. */
export function depthAlong(view: ViewDef, v: Vec3): number {
  const t = view.towardViewer;
  return -(v.x * t.x + v.y * t.y + v.z * t.z);
}
