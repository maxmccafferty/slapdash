/**
 * Quality tiers: what to turn down so the model stays smooth on the owner's phone, iPad and
 * laptop. The starting tier comes from the device; the governor then steps it down when
 * frames are slow during interaction, and back up when there is headroom.
 */
export type QualityTier = 'low' | 'medium' | 'high';

export const TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

export interface TierSettings {
  /** Device-pixel-ratio cap. */
  dprMax: number;
  shadowMapSize: number;
  /** Ambient occlusion: off, half resolution, or full resolution. */
  ao: 'off' | 'half' | 'full';
  /** MSAA samples for the effect composer; 0 uses SMAA instead. */
  msaa: number;
  /** Normal and roughness maps (colour maps always load). */
  detailMaps: boolean;
  /** Texture anisotropy cap. */
  anisotropy: number;
}

export const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  low: { dprMax: 1.5, shadowMapSize: 1024, ao: 'off', msaa: 0, detailMaps: false, anisotropy: 2 },
  medium: { dprMax: 2, shadowMapSize: 2048, ao: 'half', msaa: 4, detailMaps: true, anisotropy: 4 },
  high: { dprMax: 2, shadowMapSize: 4096, ao: 'full', msaa: 4, detailMaps: true, anisotropy: 8 },
};

export interface DeviceEnv {
  /** `(pointer: coarse)` matches: a touch-first device. */
  coarsePointer: boolean;
  /** Viewport width in CSS px. */
  width: number;
}

/** Phone → low, other touch devices (iPad) → medium, everything else → high. */
export function initialTier(env: DeviceEnv): QualityTier {
  if (env.coarsePointer && env.width < 900) return 'low';
  if (env.coarsePointer) return 'medium';
  return 'high';
}

export function readDeviceEnv(): DeviceEnv {
  if (typeof window === 'undefined') return { coarsePointer: false, width: 1440 };
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    width: window.innerWidth,
  };
}

/**
 * Steps the tier from frame times. The canvas renders on demand, so idle time is not a slow
 * frame: only frames less than `gapMs` apart (continuous interaction or animation) count.
 * Each window of `window` frames is judged: under `lowFps` steps down, over `highFps` for
 * `upAfter` windows in a row steps up. After `maxFlips` direction changes it stops moving,
 * so the view never oscillates.
 */
export interface GovernorOptions {
  window?: number;
  lowFps?: number;
  highFps?: number;
  upAfter?: number;
  maxFlips?: number;
  gapMs?: number;
}

export interface TierGovernor {
  /** Report a frame at `now` (ms). Returns the new tier when it changes, else null. */
  frame(now: number): QualityTier | null;
  readonly tier: QualityTier;
  /** Frames per second over the last judged window (0 when idle). */
  readonly fps: number;
}

export function createTierGovernor(start: QualityTier, opts: GovernorOptions = {}): TierGovernor {
  const size = opts.window ?? 60;
  const lowFps = opts.lowFps ?? 45;
  const highFps = opts.highFps ?? 58;
  const upAfter = opts.upAfter ?? 3;
  const maxFlips = opts.maxFlips ?? 3;
  const gapMs = opts.gapMs ?? 100;
  let tier = start;
  let last = -Infinity;
  let count = 0;
  let total = 0;
  let goodWindows = 0;
  let flips = 0;
  let lastDir: -1 | 1 | 0 = 0;
  let fps = 0;

  const step = (dir: -1 | 1): QualityTier | null => {
    const i = TIERS.indexOf(tier) + dir;
    if (i < 0 || i >= TIERS.length) return null;
    if (lastDir !== 0 && lastDir !== dir) flips++;
    if (flips > maxFlips) return null;
    lastDir = dir;
    tier = TIERS[i]!;
    return tier;
  };

  return {
    get tier() {
      return tier;
    },
    get fps() {
      return fps;
    },
    frame(now) {
      const dt = now - last;
      last = now;
      if (dt > gapMs) return null;
      count++;
      total += dt;
      if (count < size) return null;
      fps = total > 0 ? (1000 * count) / total : 0;
      count = 0;
      total = 0;
      if (fps < lowFps) {
        goodWindows = 0;
        return step(-1);
      }
      if (fps > highFps) {
        goodWindows++;
        if (goodWindows >= upAfter) {
          goodWindows = 0;
          return step(1);
        }
      } else {
        goodWindows = 0;
      }
      return null;
    },
  };
}
