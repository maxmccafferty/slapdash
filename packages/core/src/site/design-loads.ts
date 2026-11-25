/**
 * Location and design loads (ADR-0002 §D3). The app supplies defaults: a default
 * location (`SLAPDASH_DEFAULT_LOCATION`, served by the keyhole), the bundled loads
 * table (`@slapdash/catalog`'s `DESIGN_LOAD_TABLE`, passed in as plain data) and
 * fallback values. A project may set its own location and override any load. Every
 * value carries its source so the UI and Claude can say where a number came from.
 * Core never reads the environment.
 *
 * Per load, the order is: the project's override, then the table row for the
 * resolved location (the project's location wins over the default), then the app's
 * fallback, then nothing.
 */
import { formatFeetInches, parseLength, type Result } from '../units/length.ts';
import {
  DESIGN_LOAD_KEYS,
  DESIGN_LOAD_UNITS,
  type DesignLoadKey,
  type DesignLoadUnit,
  type Project,
} from '../model/schema.ts';

/** 1 psf in kPa. */
export const KPA_PER_PSF = 0.047880258980;
/** 1 mph in m/s. */
export const MS_PER_MPH = 0.44704;

export interface DesignLoadValue {
  value: number;
  unit: DesignLoadUnit;
  source: string;
  note?: string;
}

export interface ResolvedDesignLoad extends DesignLoadValue {
  /** True when the value comes from the project rather than the app default. */
  overridden: boolean;
  /** Where it was resolved from: the project override, the loads table or the app fallback. */
  origin: 'project' | 'table' | 'default';
}

export interface DefaultLocation {
  label: string;
  lat?: number;
  lon?: number;
}

/** One place in the bundled loads table, with SI values and their sources. */
export interface DesignLoadTableEntry {
  /** Display label, e.g. "Bend, OR". */
  label: string;
  loads: Partial<Record<DesignLoadKey, DesignLoadValue>>;
}

/** The bundled loads table, keyed by `normalizeLocationKey(label)`. Plain data (it goes to the solver worker). */
export type DesignLoadTable = Record<string, DesignLoadTableEntry>;

export interface SiteDefaults {
  location?: DefaultLocation;
  /** The bundled loads table, looked up by the resolved location. */
  table?: DesignLoadTable;
  /** App fallbacks, used for any load neither the project nor the table gives. */
  loads?: Partial<Record<DesignLoadKey, DesignLoadValue>>;
}

export interface ResolvedSite {
  location: (DefaultLocation & { source: 'project' | 'default' }) | undefined;
  /** True when the resolved location has a row in the loads table. */
  locationInTable: boolean;
  loads: Record<DesignLoadKey, ResolvedDesignLoad | undefined>;
}

/**
 * The table key for a place name: lower case, whitespace collapsed, and the state
 * code after a comma ("Bend OR", " bend ,  or " and "Bend, OR" all give "bend, or").
 */
export function normalizeLocationKey(label: string): string {
  let s = label.trim().toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(/\s*,\s*/g, ', ');
  if (!s.includes(',')) s = s.replace(/ ([a-z]{2})$/, ', $1');
  return s;
}

/** The table row for a place name, if any. */
export function lookupDesignLoads(table: DesignLoadTable | undefined, label: string | undefined): DesignLoadTableEntry | undefined {
  if (!table || !label) return undefined;
  const key = normalizeLocationKey(label);
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * Resolve the site: the project's location wins over the default; per load, the
 * project override wins, then the table row for the location, then the app fallback.
 * Each value says where it came from.
 */
export function resolveDesignLoads(project: Project, defaults: SiteDefaults = {}): ResolvedSite {
  const loc = project.site.location;
  let location: ResolvedSite['location'];
  if (loc) location = { ...loc, source: 'project' };
  else if (defaults.location) location = { ...defaults.location, source: 'default' };
  const row = lookupDesignLoads(defaults.table, location?.label);

  const loads = {} as Record<DesignLoadKey, ResolvedDesignLoad | undefined>;
  for (const key of DESIGN_LOAD_KEYS) {
    const override = project.site.designLoads[key];
    const fromTable = row?.loads[key];
    const fallback = defaults.loads?.[key];
    if (override) loads[key] = { ...override, overridden: true, origin: 'project' };
    else if (fromTable) loads[key] = { ...fromTable, overridden: false, origin: 'table' };
    else if (fallback) loads[key] = { ...fallback, overridden: false, origin: 'default' };
    else loads[key] = undefined;
  }
  return { location, locationInTable: row !== undefined, loads };
}

const LABELS: Record<DesignLoadKey, string> = {
  groundSnow: 'ground snow load',
  windSpeed: 'wind speed',
  frostDepth: 'frost depth',
};

/** Plausible ranges, in SI, used to catch typos like "300 psf". */
export const DESIGN_LOAD_RANGES: Record<DesignLoadKey, { min: number; max: number }> = {
  groundSnow: { min: 0, max: 15 },
  windSpeed: { min: 0, max: 90 },
  frostDepth: { min: 0, max: 3000 },
};

export function designLoadLabel(key: DesignLoadKey): string {
  return LABELS[key];
}

/** Show a stored SI value the way a US builder reads it: psf, mph, feet and inches. */
export function formatLoad(key: DesignLoadKey, value: number): string {
  switch (key) {
    case 'groundSnow':
      return `${Number((value / KPA_PER_PSF).toFixed(1))} psf`;
    case 'windSpeed':
      return `${Number((value / MS_PER_MPH).toFixed(1))} mph`;
    case 'frostDepth':
      return formatFeetInches(value);
  }
}

const UNIT_HINTS: Record<DesignLoadKey, string> = {
  groundSnow: 'e.g. "30 psf" or "1.44 kPa"',
  windSpeed: 'e.g. "115 mph" or "51 m/s"',
  frostDepth: 'e.g. "36in", "3ft" or "915mm"',
};

/**
 * Read a design load given by a person. Numbers are taken as SI (kPa, m/s, mm);
 * text may use psf/kPa, mph/m/s/km/h, or any length. Result is SI.
 */
export function parseDesignLoad(key: DesignLoadKey, input: number | string): Result<number> {
  if (typeof input === 'number') return { ok: true, value: input };
  const s = input.trim().toLowerCase();
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)\s*([a-z/ ]*)$/.exec(s);
  const unitless = m !== null && m[2]!.trim() === '';
  if (unitless) {
    return {
      ok: false,
      error: `"${input}" has no unit. Give the ${LABELS[key]} with a unit, ${UNIT_HINTS[key]}.`,
    };
  }
  if (key === 'frostDepth') {
    const len = parseLength(input);
    return len.ok ? len : { ok: false, error: `Couldn't read "${input}" as a frost depth; ${UNIT_HINTS[key]}.` };
  }
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.replace(/\s+/g, '');
    if (key === 'groundSnow') {
      if (unit === 'psf' || unit === 'lb/ft2' || unit === 'lbs/ft2') return { ok: true, value: n * KPA_PER_PSF };
      if (unit === 'kpa') return { ok: true, value: n };
    } else {
      if (unit === 'mph') return { ok: true, value: n * MS_PER_MPH };
      if (unit === 'm/s' || unit === 'mps') return { ok: true, value: n };
      if (unit === 'km/h' || unit === 'kph') return { ok: true, value: n / 3.6 };
    }
  }
  return { ok: false, error: `Couldn't read "${input}" as a ${LABELS[key]}; ${UNIT_HINTS[key]}.` };
}

export function designLoadUnit(key: DesignLoadKey): DesignLoadUnit {
  return DESIGN_LOAD_UNITS[key];
}
