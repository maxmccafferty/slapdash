import { PROJECT_SCHEMA_VERSION, zProject, type Project } from './schema.ts';
import { zodIssuesToErrors } from '../commands/errors.ts';

export type ProjectResult = { ok: true; project: Project } | { ok: false; errors: string[] };

/**
 * Bring a raw project (e.g. read from a file) up to the current schema version and
 * validate it. Each version's step falls through to the next:
 *
 * - v1 → v2 adds optional part `cuts`. A v1 file has none, so only the version changes.
 */
export function migrateProject(raw: unknown): ProjectResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The project should be a JSON object.'] };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  // v1 → v2: optional part cuts were added; a v1 file has none.
  if (version === 1) raw = { ...raw, schemaVersion: 2 };
  switch (version) {
    case 1:
    case 2: {
      const parsed = zProject.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, errors: zodIssuesToErrors(parsed.error.issues, raw).map((e) => e.message) };
      }
      return { ok: true, project: parsed.data };
    }
    default:
      return {
        ok: false,
        errors: [
          version === undefined
            ? `The project has no schemaVersion; this app understands up to ${PROJECT_SCHEMA_VERSION}.`
            : `This project is version ${String(version)}; this app understands up to ${PROJECT_SCHEMA_VERSION}.`,
        ],
      };
  }
}
