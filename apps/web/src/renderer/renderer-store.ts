/**
 * Renderer-only state that the shell or debug tools read: the quality tier, the fitted
 * camera distance (for the zoom readout) and frame statistics. Frame stats are a plain
 * mutable object, not store state, so counting frames never re-renders React.
 */
import { create } from 'zustand';
import type { Vec3 } from '@slapdash/core';
import { TIERS, initialTier, readDeviceEnv, type QualityTier } from './quality.ts';

export interface FrameStats {
  frames: number;
  fps: number;
  lastFrameAt: number;
}

export interface RendererState {
  tier: QualityTier;
  setTier: (tier: QualityTier) => void;
  /** Camera distance at 100% (the initial fit), metres. */
  fitDistance: number;
  setFitDistance: (d: number) => void;
  /** Where the user's camera is, for tests and the debug hook. Set by the camera rig. */
  readCamera: () => { position: Vec3; target: Vec3 } | null;
  setReadCamera: (fn: () => { position: Vec3; target: Vec3 } | null) => void;
}

export const frameStats: FrameStats = { frames: 0, fps: 0, lastFrameAt: 0 };

/** `?tier=low|medium|high` forces the starting tier, for device testing. */
function startingTier(): QualityTier {
  const forced = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tier');
  return TIERS.includes(forced as QualityTier) ? (forced as QualityTier) : initialTier(readDeviceEnv());
}

export const useRendererStore = create<RendererState>()((set) => ({
  tier: startingTier(),
  setTier: (tier) => set({ tier }),
  fitDistance: 0,
  setFitDistance: (fitDistance) => set({ fitDistance }),
  readCamera: () => null,
  setReadCamera: (readCamera) => set({ readCamera }),
}));
