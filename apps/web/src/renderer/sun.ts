/**
 * Where the sun is: mid-afternoon on today's date at the project's location, so shadows
 * fall the way they will on site. Without a location, a fixed south-west-high sun at
 * latitude 37°.
 */
import { getPosition } from 'suncalc';
import type { SiteLocation, Vec3 } from '@slapdash/core';

export const DEFAULT_LATITUDE = 37;
/** Below this the shadows get too long to read the model. */
const MIN_ALTITUDE_DEG = 25;

/**
 * Unit vector from the scene toward the sun (y up, north −z, east +x). Mid-afternoon is
 * 15:00 local solar time, estimated from the longitude.
 */
export function sunDirection(location: SiteLocation | undefined, today: Date = new Date()): Vec3 {
  const lat = location?.lat ?? DEFAULT_LATITUDE;
  const lon = location?.lon ?? 0;
  const solarAfternoon = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 15) - (lon / 15) * 3_600_000;
  const pos = getPosition(new Date(solarAfternoon), lat, lon);
  const alt = (Math.max(pos.altitude, MIN_ALTITUDE_DEG) * Math.PI) / 180;
  const az = (pos.azimuth * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(alt), y: Math.sin(alt), z: -Math.cos(az) * Math.cos(alt) };
}
