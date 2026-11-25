/**
 * Roof pitch. US carpentry speaks in rise per 12 of run ("6 in 12"); some people
 * give an angle. Both parse to the same {@link Pitch}.
 */
import type { Result } from './length.ts';

export interface Pitch {
  /** Rise in inches per 12 inches of run. */
  rise: number;
  /** Always 12: pitches are normalised to x-in-12. */
  run: 12;
  /** rise / run. */
  ratio: number;
  /** Angle from horizontal, in degrees. */
  degrees: number;
}

const DEG_PER_RAD = 180 / Math.PI;
const EXAMPLES = 'Try "6 in 12", "6/12" or "26.57deg".';

/** Build a pitch from a rise:run ratio. */
export function pitchFromRatio(ratio: number): Pitch {
  return { rise: ratio * 12, run: 12, ratio, degrees: Math.atan(ratio) * DEG_PER_RAD };
}

/** Build a pitch from an angle in degrees. */
export function pitchFromDegrees(degrees: number): Pitch {
  const ratio = Math.tan(degrees / DEG_PER_RAD);
  return { rise: ratio * 12, run: 12, ratio, degrees };
}

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const RATIO = new RegExp(String.raw`^${NUM}\s*(?:in|/|:)\s*${NUM}$`);
const DEGREES = new RegExp(String.raw`^${NUM}\s*(?:°|deg|degs|degree|degrees)$`);

/** Parse `"6 in 12"`, `"6/12"`, `"6:12"`, `"26.57deg"` or `"26.57°"`. */
export function parsePitch(input: string): Result<Pitch> {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const original = input.trim();
  let m = RATIO.exec(s);
  if (m) {
    const rise = Number(m[1]);
    const run = Number(m[2]);
    if (run === 0) return { ok: false, error: `"${original}" has a run of zero. ${EXAMPLES}` };
    return { ok: true, value: pitchFromRatio(rise / run) };
  }
  m = DEGREES.exec(s);
  if (m) {
    const deg = Number(m[1]);
    if (deg >= 90) {
      return { ok: false, error: `A roof pitch must be less than 90 degrees (you gave ${original}).` };
    }
    return { ok: true, value: pitchFromDegrees(deg) };
  }
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return {
      ok: false,
      error: `"${original}" is ambiguous. Write it as "${original} in 12" or "${original}deg".`,
    };
  }
  return { ok: false, error: `Couldn't read "${original}" as a roof pitch. ${EXAMPLES}` };
}

/**
 * Format a pitch as `6 in 12` (rise rounded to the nearest 1/4), or as degrees
 * (`32.5°`) when the pitch is not close to a quarter-inch rise.
 */
export function formatPitch(pitch: Pitch): string {
  const quarter = Math.round(pitch.rise * 4) / 4;
  if (Math.abs(pitch.rise - quarter) < 0.01) {
    return `${quarter} in 12`;
  }
  return `${Number(pitch.degrees.toFixed(2))}°`;
}
