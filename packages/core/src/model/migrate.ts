import { PROJECT_SCHEMA_VERSION, zProject, type Project } from './schema.ts';
import { zodIssuesToErrors } from '../commands/errors.ts';

export type ProjectResult = { ok: true; project: Project } | { ok: false; errors: string[] };

/**
 * Bring a raw project (e.g. read from a file) up to the current schema version and
 * validate it. Only v1 exists today; later versions add a step here.
 */
export function migrateProject(raw: unknown): ProjectResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The project should be a JSON object.'] };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  switch (version) {
    case 1: {
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
