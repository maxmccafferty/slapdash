/**
 * Site loads from the project's design loads (ADR-0002 §D3): roof snow from ground snow
 * (ASCE 7-22 Ch. 7) and velocity pressure from wind speed (ASCE 7-22 Ch. 26). Every
 * number keeps its source so it can be quoted.
 */
import { BUILDER_DEFAULTS, KPA_PER_PSF, MS_PER_MPH, resolveDesignLoads, type Project, type SiteDefaults } from '@slapdash/core';
import type { SourcedValue } from '../types.ts';

/** 115 mph: ASCE 7-22 Risk Category II basic wind speed over much of the inland US. */
export const DEFAULT_WIND_SPEED_MS = 115 * MS_PER_MPH;

/**
 * Roof slope factor Cs, ASCE 7-22 Fig. 7.4-1, warm roof (Ct ≤ 1.0), not slippery:
 * 1.0 up to 30°, falling linearly to 0 at 70°.
 */
export function slopeFactor(slopeDeg: number): number {
  if (slopeDeg <= 30) return 1;
  if (slopeDeg >= 70) return 0;
  return (70 - slopeDeg) / 40;
}

/** Flat-roof snow pf = 0.7·Ce·Ct·Is·pg (ASCE 7-22 Eq. 7.3-1) with Ce = Ct = Is = 1.0. */
export function flatRoofSnow(pg: number, Ce = 1, Ct = 1, Is = 1): number {
  return 0.7 * Ce * Ct * Is * pg;
}

/**
 * Velocity pressure exposure coefficient Kz, exposure C (ASCE 7-22 Table 26.10-1:
 * α = 9.5, zg = 900 ft), with z not less than 15 ft.
 */
export function exposureCKz(heightMm: number): number {
  const zFt = Math.max(15, heightMm / 304.8);
  return 2.01 * (zFt / 900) ** (2 / 9.5);
}

/** qh = 0.613·Kz·Kzt·Kd·Ke·V², Pa (ASCE 7-22 Eq. 26.10-1); returned in kPa. */
export function velocityPressure(V: number, Kz: number, Kzt = 1, Kd = 0.85, Ke = 1): number {
  return (0.613 * Kz * Kzt * Kd * Ke * V * V) / 1000;
}

export interface SiteLoads {
  groundSnow: SourcedValue;
  windSpeed: SourcedValue;
}

export function siteLoads(project: Project, defaults: SiteDefaults | undefined): SiteLoads {
  const site = resolveDesignLoads(project, defaults);
  const snow = site.loads.groundSnow;
  const wind = site.loads.windSpeed;
  return {
    groundSnow: snow
      ? { value: snow.value, unit: 'kPa', source: snow.overridden ? `project: ${snow.source}` : snow.source }
      : {
          value: BUILDER_DEFAULTS.groundSnowPsf * KPA_PER_PSF,
          unit: 'kPa',
          source: `default ${BUILDER_DEFAULTS.groundSnowPsf} psf ground snow (no location set)`,
        },
    windSpeed: wind
      ? { value: wind.value, unit: 'm/s', source: wind.overridden ? `project: ${wind.source}` : wind.source }
      : { value: DEFAULT_WIND_SPEED_MS, unit: 'm/s', source: 'default 115 mph basic wind speed (no location set)' },
  };
}
