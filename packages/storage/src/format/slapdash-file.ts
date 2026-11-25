/**
 * The `.slapdash` file: one project (model, undo history, named versions, chat and files)
 * as UTF-8 JSON. Files are embedded as base64.
 *
 * Versioning: `formatVersion` describes this wrapper. The project inside carries its own
 * `schemaVersion`, which `migrateProject` upgrades. To change the wrapper, bump
 * SLAPDASH_FORMAT_VERSION and add a step to `migrateSlapdashFile`.
 */
import { z } from 'zod';
import { validateRecordBody, type RecordBody } from '../record.ts';
import type { ProjectRecord } from '../types.ts';
import { base64ToBytes, bytesToBase64 } from './base64.ts';

export const SLAPDASH_FORMAT = 'slapdash';
export const SLAPDASH_FORMAT_VERSION = 1;
export const SLAPDASH_EXTENSION = '.slapdash';
export const SLAPDASH_MIME_TYPE = 'application/vnd.slapdash+json';

/** A file as it travels in a .slapdash file. */
export interface PortableFile {
  id: string;
  name: string;
  mimeType: string;
  createdAt: number;
  bytes: Uint8Array;
}

export type DecodedSlapdashFile =
  | { ok: true; record: RecordBody; files: PortableFile[]; exportedAt: number }
  | { ok: false; errors: string[] };

const zFileEntry = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  createdAt: z.number(),
  data: z.string(),
});

const zFileV1 = z.object({
  format: z.literal(SLAPDASH_FORMAT),
  formatVersion: z.literal(1),
  exportedAt: z.number(),
  meta: z.unknown(),
  project: z.unknown(),
  history: z.unknown(),
  chat: z.unknown(),
  files: z.array(zFileEntry),
});

/** JSON with object keys sorted at every level, so the same data always gives the same text. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Uint8Array) throw new Error('bytes must be base64-encoded first');
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

/**
 * Encode a project and its files. Deterministic: the same inputs (and clock) give
 * byte-identical text. Top-level fields come in a fixed order; nested keys are sorted.
 */
export function encodeSlapdashFile(
  record: ProjectRecord | RecordBody,
  files: readonly PortableFile[],
  opts: { now?: () => number } = {},
): string {
  const sortedFiles = [...files].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const doc = {
    format: SLAPDASH_FORMAT,
    formatVersion: SLAPDASH_FORMAT_VERSION,
    exportedAt: (opts.now ?? Date.now)(),
    meta: canonical(record.meta),
    project: canonical(record.project),
    history: canonical(record.history),
    chat: canonical(record.chat),
    files: sortedFiles.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdAt: f.createdAt,
      data: bytesToBase64(f.bytes),
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Bring a parsed file up to the current format version. */
export function migrateSlapdashFile(raw: unknown): { ok: true; file: z.infer<typeof zFileV1> } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["This isn't a .slapdash file: it should contain a JSON object."] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== SLAPDASH_FORMAT) {
    return { ok: false, errors: ["This isn't a .slapdash file: it's JSON, but not a Slapdash project."] };
  }
  const version = obj.formatVersion;
  switch (version) {
    case 1: {
      const parsed = zFileV1.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          errors: parsed.error.issues.map((i) => `This .slapdash file is damaged (${i.path.join('.') || 'top level'}: ${i.message}).`),
        };
      }
      return { ok: true, file: parsed.data };
    }
    default:
      if (typeof version === 'number' && version > SLAPDASH_FORMAT_VERSION) {
        return {
          ok: false,
          errors: [
            `This file was made by a newer Slapdash (file format ${version}; this app reads up to ${SLAPDASH_FORMAT_VERSION}). Update the app and try again.`,
          ],
        };
      }
      return {
        ok: false,
        errors: [
          version === undefined
            ? "This .slapdash file is damaged: it doesn't say which format version it uses."
            : `This .slapdash file is damaged: "${String(version)}" isn't a format version this app knows.`,
        ],
      };
  }
}

/** Read a .slapdash file. Errors are plain sentences that can be shown to the user. */
export function decodeSlapdashFile(text: string): DecodedSlapdashFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`This isn't a .slapdash file: it couldn't be read as JSON (${detail}).`] };
  }
  const migrated = migrateSlapdashFile(raw);
  if (!migrated.ok) return migrated;
  const { file } = migrated;

  const body = validateRecordBody({ meta: file.meta, project: file.project, history: file.history, chat: file.chat });
  const errors = body.ok ? [] : [...body.errors];

  const files: PortableFile[] = [];
  const seen = new Set<string>();
  for (const entry of file.files) {
    const bytes = base64ToBytes(entry.data);
    if (!bytes) {
      errors.push(`The attached file "${entry.name}" is damaged (its data isn't valid base64).`);
      continue;
    }
    if (seen.has(entry.id)) {
      errors.push(`The attached file "${entry.name}" appears twice (id "${entry.id}").`);
      continue;
    }
    seen.add(entry.id);
    files.push({ id: entry.id, name: entry.name, mimeType: entry.mimeType, createdAt: entry.createdAt, bytes });
  }

  if (!body.ok || errors.length > 0) return { ok: false, errors };
  return { ok: true, record: body.record, files, exportedAt: file.exportedAt };
}

/** A filesystem-safe file name for a project, e.g. "Pool house" → "pool-house.slapdash". */
export function slapdashFileName(projectName: string): string {
  const slug = projectName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${slug || 'project'}${SLAPDASH_EXTENSION}`;
}
