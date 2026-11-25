/**
 * Applies the quality tier and adapts it: counts frames, steps the tier down when
 * interaction is slow and back up when there is headroom (see `createTierGovernor`).
 *
 * drei's `PerformanceMonitor` isn't used because it measures frames per second of wall
 * time: with the canvas rendering on demand, an idle second reads as 0 fps and would drop
 * the tier for no reason. The governor only judges back-to-back frames.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { createTierGovernor, TIER_SETTINGS } from './quality.ts';
import { frameStats, useRendererStore } from './renderer-store.ts';
import { setTextureAnisotropy } from './textures.ts';

export function QualityManager() {
  const tier = useRendererStore((s) => s.tier);
  const setTier = useRendererStore((s) => s.setTier);
  const setDpr = useThree((s) => s.setDpr);
  // The governor starts from the tier at mount and keeps its own history afterwards.
  const [governor] = useState(() => createTierGovernor(useRendererStore.getState().tier));

  useEffect(() => {
    const settings = TIER_SETTINGS[tier];
    setDpr(Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, settings.dprMax));
    void setTextureAnisotropy(settings.anisotropy);
  }, [tier, setDpr]);

  useFrame(() => {
    const now = performance.now();
    frameStats.frames++;
    frameStats.lastFrameAt = now;
    const next = governor.frame(now);
    frameStats.fps = governor.fps;
    if (next) setTier(next);
  });

  return null;
}
