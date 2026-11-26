import { CATALOG_SCHEMA_VERSION } from './schema.ts';
import type { Result } from '../units/length.ts';

/**
 * Bring a raw catalog up to the current schema version. Only v1 exists today, so
 * this passes v1 through and rejects anything else in plain language. Future
 * versions add a step here (v1 → v2 → …).
 */
export function migrateCatalog(raw: unknown): Result<unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'The catalog should be a JSON object.' };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) {
    return { ok: false, error: `The catalog has no schemaVersion; this app understands up to ${CATALOG_SCHEMA_VERSION}.` };
  }
  switch (version) {
    case 1:
      return { ok: true, value: raw };
    default:
      return {
        ok: false,
        error: `This catalog is version ${String(version)}; this app understands up to ${CATALOG_SCHEMA_VERSION}.`,
      };
  }
}
