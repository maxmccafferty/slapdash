/** Validation for stored and imported project records. */
import { migrateProject, type SerializedBus } from '@slapdash/core';
import { z } from 'zod';
import { zChatLog } from './chat.ts';
import type { ProjectRecord, ProjectSummary } from './types.ts';

export const zProjectMeta = z.strictObject({
  name: z.string(),
  named: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const zAppliedCommand = z.looseObject({ name: z.string(), input: z.unknown() });

const zHistoryEntry = z.looseObject({
  id: z.number(),
  label: z.string(),
  source: z.enum(['claude', 'user', 'system']),
  turnId: z.string().optional(),
  at: z.number(),
  commands: z.array(
    z.looseObject({
      redo: zAppliedCommand,
      inverse: z.array(zAppliedCommand),
      summary: z.string(),
    }),
  ),
});

const zSavedVersion = z.looseObject({
  name: z.string(),
  note: z.string().optional(),
  savedAt: z.number(),
  project: z.unknown(),
});

/**
 * The command bus history. Loose objects: unknown keys are kept, never stripped, so a
 * newer core can add fields without older storage code losing them. Command inputs are
 * checked by the bus when they run.
 */
export const zSerializedBus = z.looseObject({
  version: z.literal(1),
  undo: z.array(zHistoryEntry),
  redo: z.array(zHistoryEntry),
  versions: z.array(zSavedVersion),
  nextEntryId: z.number().int().positive(),
});

export type RecordBody = Omit<ProjectRecord, 'id'>;
export type Validated<T> = { ok: true; record: T } | { ok: false; errors: string[] };

function pathToString(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

function issueMessages(where: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = pathToString(issue.path);
    return `${where}${path ? ` ("${path}")` : ''}: ${issue.message}.`;
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Check a record without its id (as read from storage or a .slapdash file). The project
 * and every saved version's project go through `migrateProject`, so older model versions
 * are upgraded. Errors are plain sentences.
 */
export function validateRecordBody(raw: unknown): Validated<RecordBody> {
  if (!isObject(raw)) return { ok: false, errors: ['The project record should be a JSON object.'] };
  const errors: string[] = [];

  const meta = zProjectMeta.safeParse(raw.meta);
  if (!meta.success) errors.push(...issueMessages('The project details', meta.error));

  const project = migrateProject(raw.project);
  if (!project.ok) errors.push(...project.errors.map((e) => `The model: ${e}`));

  let history: SerializedBus | null = null;
  if (raw.history !== null && raw.history !== undefined) {
    const parsed = zSerializedBus.safeParse(raw.history);
    if (!parsed.success) {
      errors.push(...issueMessages('The undo history', parsed.error));
    } else {
      const versions = parsed.data.versions.map((v) => {
        const p = migrateProject(v.project);
        if (!p.ok) {
          errors.push(...p.errors.map((e) => `The saved version "${v.name}": ${e}`));
          return v;
        }
        return { ...v, project: p.project };
      });
      history = { ...parsed.data, versions } as unknown as SerializedBus;
    }
  }

  const chat = zChatLog.safeParse(raw.chat);
  if (!chat.success) errors.push(...issueMessages('The chat', chat.error));

  if (errors.length > 0 || !meta.success || !project.ok || !chat.success) return { ok: false, errors };
  return { ok: true, record: { meta: meta.data, project: project.project, history, chat: chat.data } };
}

/** Check a whole record, including its id. Returns a normalised copy on success. */
export function validateRecord(raw: unknown): Validated<ProjectRecord> {
  if (!isObject(raw)) return { ok: false, errors: ['The project record should be a JSON object.'] };
  const body = validateRecordBody(raw);
  const idOk = typeof raw.id === 'string' && raw.id.length > 0;
  if (!idOk) {
    const errors = ['The project record has no id.'];
    return { ok: false, errors: body.ok ? errors : [...errors, ...body.errors] };
  }
  if (!body.ok) return body;
  return { ok: true, record: { id: raw.id as string, ...body.record } };
}

export function summarize(record: ProjectRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.meta.name,
    named: record.meta.named,
    createdAt: record.meta.createdAt,
    updatedAt: record.meta.updatedAt,
    partCount: Object.keys(record.project.parts).length,
  };
}
