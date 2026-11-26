/**
 * The bundled design loads table (ADR-0002 §D3, ADR-0003 §J1): ground snow load, wind
 * speed and frost depth for a list of US places, each value with its source. The app
 * looks the resolved location up here (`resolveDesignLoads` in `@slapdash/core`); a
 * project's own overrides still win. Values are hand-entered reference data: a row
 * leaves out anything that couldn't be checked against its source, and the app's
 * fallbacks fill the gap and say so.
 *
 * The file is US units as published (psf, mph, inches); this module converts to the
 * model's SI (kPa, m/s, mm).
 */
import { z } from 'zod';
import {
  DESIGN_LOAD_RANGES,
  KPA_PER_PSF,
  MM_PER_INCH,
  MS_PER_MPH,
  normalizeLocationKey,
  type DesignLoadKey,
  type DesignLoadTable,
  type DesignLoadValue,
} from '@slapdash/core';
import raw from '../data/design-loads.json' with { type: 'json' };

const zSource = z.string().trim().min(1);

export const zDesignLoadRow = z.strictObject({
  /** "City, ST". */
  label: z.string().regex(/^[^,]+, [A-Z]{2}$/, 'should be "City, ST"'),
  groundSnowPsf: z.number().nonnegative().nullable(),
  windMph: z.number().positive().nullable(),
  frostDepthIn: z.number().nonnegative().nullable(),
  /** One citation per value given. */
  sources: z.strictObject({ groundSnow: zSource.optional(), windSpeed: zSource.optional(), frostDepth: zSource.optional() }),
  /** Where each value was read. */
  urls: z.strictObject({ groundSnow: z.url().optional(), windSpeed: z.url().optional(), frostDepth: z.url().optional() }).optional(),
  /** Retrieval month, "YYYY-MM". */
  retrieved: z.string().regex(/^\d{4}-\d{2}$/),
});
export type DesignLoadRow = z.infer<typeof zDesignLoadRow>;

export const zDesignLoadFile = z.array(zDesignLoadRow);

const FIELDS: ReadonlyArray<{ key: DesignLoadKey; field: 'groundSnowPsf' | 'windMph' | 'frostDepthIn'; unit: DesignLoadValue['unit']; toSI: number }> = [
  { key: 'groundSnow', field: 'groundSnowPsf', unit: 'kPa', toSI: KPA_PER_PSF },
  { key: 'windSpeed', field: 'windMph', unit: 'm/s', toSI: MS_PER_MPH },
  { key: 'frostDepth', field: 'frostDepthIn', unit: 'mm', toSI: MM_PER_INCH },
];

/** Check the rows: every value has a source, sits in the plausible range, and no place is listed twice. */
export function validateDesignLoadRows(rows: unknown): { ok: true; rows: DesignLoadRow[] } | { ok: false; errors: string[] } {
  const parsed = zDesignLoadFile.safeParse(rows);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of parsed.data) {
    const key = normalizeLocationKey(row.label);
    if (seen.has(key)) errors.push(`${row.label} is listed twice.`);
    seen.add(key);
    for (const f of FIELDS) {
      const v = row[f.field];
      if (v === null) {
        if (row.sources[f.key]) errors.push(`${row.label}: has a ${f.key} source but no value.`);
        continue;
      }
      if (!row.sources[f.key]) errors.push(`${row.label}: ${f.key} has no source.`);
      const si = v * f.toSI;
      const { min, max } = DESIGN_LOAD_RANGES[f.key];
      if (si < min || si > max) errors.push(`${row.label}: ${f.key} ${v} is outside the plausible range.`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows: parsed.data };
}

/** Convert rows to the core table shape: SI values keyed by `normalizeLocationKey`. */
export function toDesignLoadTable(rows: readonly DesignLoadRow[]): DesignLoadTable {
  const table: DesignLoadTable = {};
  for (const row of rows) {
    const loads: Partial<Record<DesignLoadKey, DesignLoadValue>> = {};
    for (const f of FIELDS) {
      const v = row[f.field];
      if (v === null) continue;
      loads[f.key] = { value: v * f.toSI, unit: f.unit, source: `${row.sources[f.key]!}, retrieved ${row.retrieved}` };
    }
    table[normalizeLocationKey(row.label)] = { label: row.label, loads };
  }
  return table;
}

const result = validateDesignLoadRows(raw);
if (!result.ok) throw new Error(`The design loads table is invalid:\n- ${result.errors.join('\n- ')}`);

/** The rows as published (US units), for docs and tests. */
export const DESIGN_LOAD_ROWS: readonly DesignLoadRow[] = result.rows;

/** The bundled design loads table, SI, keyed by normalised "city, st". Plain data. */
export const DESIGN_LOAD_TABLE: DesignLoadTable = toDesignLoadTable(result.rows);
