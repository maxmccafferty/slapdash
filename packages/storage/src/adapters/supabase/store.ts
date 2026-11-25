/**
 * ProjectStore over Supabase: one `projects` row per project (summary columns + jsonb body
 * and chat), `project_files` rows for file metadata, and file bytes in the private
 * `project-files` bucket at `<user_id>/<project_id>/<file_id>`. Row-level security limits
 * every query to the signed-in user (supabase/migrations).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageError } from '../../errors.ts';
import { summarize, validateRecord } from '../../record.ts';
import type { FileRef, NewFile, ProjectFiles, ProjectRecord, ProjectStore, ProjectSummary, StoredFile } from '../../types.ts';
import { SIGNED_OUT_MESSAGE, toStorageError } from './errors.ts';

export const PROJECTS_TABLE = 'projects';
export const FILES_TABLE = 'project_files';
export const FILES_BUCKET = 'project-files';

/** Storage removes at most this many objects per call. */
const REMOVE_BATCH = 100;

interface ProjectRow {
  id: string;
  name: string;
  named: boolean;
  created_at: number;
  updated_at: number;
  part_count: number;
}

interface FileRow {
  project_id: string;
  id: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: number;
}

const SUMMARY_COLUMNS = 'id,name,named,created_at,updated_at,part_count';
const FILE_COLUMNS = 'project_id,id,name,mime_type,size,created_at';

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    named: row.named,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    partCount: row.part_count,
  };
}

function toRef(row: FileRow): FileRef {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: Number(row.created_at),
  };
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * An id as one storage path segment. Storage keys allow only a few characters (no `%`, so
 * not URI encoding): plain ids pass through and anything else becomes `b64.<base64url>`.
 * A plain id never contains a dot, so the two forms can't collide.
 */
export function pathSegment(id: string): string {
  if (SAFE_SEGMENT.test(id)) return id;
  const bytes = new TextEncoder().encode(id);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `b64.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function objectPath(userId: string, projectId: string, fileId: string): string {
  return `${userId}/${pathSegment(projectId)}/${pathSegment(fileId)}`;
}

type Result<T> = { data: T; error: unknown; status?: number };

/** Unwrap a supabase-js result, turning errors (returned or thrown) into StorageErrors. */
async function run<T>(fn: () => PromiseLike<Result<T>>): Promise<T> {
  let res: Result<T>;
  try {
    res = await fn();
  } catch (e) {
    throw toStorageError(e);
  }
  if (res.error) throw toStorageError(res.error, res.status);
  return res.data;
}

/** The signed-in user's id; every write needs it. Reads the stored session (no network). */
export async function requireUserId(client: SupabaseClient): Promise<string> {
  let id: string | undefined;
  try {
    id = (await client.auth.getSession()).data.session?.user.id;
  } catch (e) {
    throw toStorageError(e);
  }
  if (!id) throw new StorageError('unavailable', SIGNED_OUT_MESSAGE);
  return id;
}

function isMissingObject(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown; name?: unknown };
  const status = Number(e?.statusCode ?? e?.status);
  return status === 404 || (status === 400 && /not.?found/i.test(String(e?.message))) || /object not found/i.test(String(e?.message));
}

export class SupabaseFiles implements ProjectFiles {
  readonly #client: SupabaseClient;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(client: SupabaseClient, now: () => number, newId: () => string) {
    this.#client = client;
    this.#now = now;
    this.#newId = newId;
  }

  async put(projectId: string, file: NewFile): Promise<FileRef> {
    const userId = await requireUserId(this.#client);
    const row: FileRow = {
      project_id: projectId,
      id: file.id ?? this.#newId(),
      name: file.name,
      mime_type: file.mimeType,
      size: file.bytes.byteLength,
      created_at: file.createdAt ?? this.#now(),
    };
    // A copy, so later changes to the caller's array can't reach the upload.
    const bytes = file.bytes.slice();
    await run(() =>
      this.#client.storage
        .from(FILES_BUCKET)
        .upload(objectPath(userId, projectId, row.id), bytes, { upsert: true, contentType: file.mimeType }),
    );
    await run(() => this.#client.from(FILES_TABLE).upsert({ user_id: userId, ...row }, { onConflict: 'user_id,project_id,id' }));
    return toRef(row);
  }

  async get(projectId: string, fileId: string): Promise<StoredFile | null> {
    const userId = await requireUserId(this.#client);
    const row = await run(() =>
      this.#client.from(FILES_TABLE).select(FILE_COLUMNS).eq('project_id', projectId).eq('id', fileId).maybeSingle<FileRow>(),
    );
    if (!row) return null;
    let blob: Blob;
    try {
      const res = await this.#client.storage.from(FILES_BUCKET).download(objectPath(userId, projectId, fileId));
      if (res.error) {
        if (isMissingObject(res.error)) return null;
        throw toStorageError(res.error);
      }
      blob = res.data;
    } catch (e) {
      throw toStorageError(e);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { ...toRef(row), bytes };
  }

  async list(projectId: string): Promise<FileRef[]> {
    const rows = await run(() =>
      this.#client
        .from(FILES_TABLE)
        .select(FILE_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .returns<FileRow[]>(),
    );
    return (rows ?? []).map(toRef);
  }

  async delete(projectId: string, fileId: string): Promise<void> {
    const userId = await requireUserId(this.#client);
    // Object first: a failure leaves the row, so a retry still finds it.
    await run(() => this.#client.storage.from(FILES_BUCKET).remove([objectPath(userId, projectId, fileId)]));
    await run(() => this.#client.from(FILES_TABLE).delete().eq('project_id', projectId).eq('id', fileId));
  }
}

export class SupabaseProjectStore implements ProjectStore {
  readonly #client: SupabaseClient;
  readonly files: ProjectFiles;

  constructor(client: SupabaseClient, opts: { now: () => number; newId: () => string }) {
    this.#client = client;
    this.files = new SupabaseFiles(client, opts.now, opts.newId);
  }

  async list(): Promise<ProjectSummary[]> {
    await requireUserId(this.#client);
    const rows = await run(() =>
      this.#client
        .from(PROJECTS_TABLE)
        .select(SUMMARY_COLUMNS)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .returns<ProjectRow[]>(),
    );
    return (rows ?? []).map(toSummary);
  }

  async load(id: string): Promise<ProjectRecord | null> {
    await requireUserId(this.#client);
    const row = await run(() =>
      this.#client.from(PROJECTS_TABLE).select('body,chat').eq('id', id).maybeSingle<{ body: unknown; chat: unknown }>(),
    );
    if (!row) return null;
    const body = (typeof row.body === 'object' && row.body !== null ? row.body : {}) as Record<string, unknown>;
    const checked = validateRecord({ ...body, id, chat: row.chat });
    if (!checked.ok) {
      const meta = body.meta as { name?: unknown } | undefined;
      const name = typeof meta?.name === 'string' ? `"${meta.name}"` : 'This project';
      throw new StorageError(
        'invalid',
        `The saved project ${name} couldn't be opened because its data is damaged. ${checked.errors[0] ?? ''}`.trim(),
        checked.errors,
      );
    }
    return checked.record;
  }

  async save(record: ProjectRecord): Promise<ProjectSummary> {
    const checked = validateRecord(record);
    if (!checked.ok) {
      throw new StorageError('invalid', `This project can't be saved: ${checked.errors[0] ?? 'it is invalid.'}`, checked.errors);
    }
    const userId = await requireUserId(this.#client);
    const { id, chat, meta, project, history } = checked.record;
    const summary = summarize(checked.record);
    // One statement, so the row is replaced whole or not at all.
    await run(() =>
      this.#client.from(PROJECTS_TABLE).upsert(
        {
          user_id: userId,
          id,
          name: summary.name,
          named: summary.named,
          created_at: summary.createdAt,
          updated_at: summary.updatedAt,
          part_count: summary.partCount,
          body: { meta, project, history },
          chat,
        },
        { onConflict: 'user_id,id' },
      ),
    );
    return summary;
  }

  async delete(id: string): Promise<void> {
    const userId = await requireUserId(this.#client);
    const rows = await run(() => this.#client.from(FILES_TABLE).select('id').eq('project_id', id).returns<{ id: string }[]>());
    const paths = (rows ?? []).map((r) => objectPath(userId, id, r.id));
    // Objects first, then rows: a failure leaves rows a retry can find, never orphaned objects.
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH);
      await run(() => this.#client.storage.from(FILES_BUCKET).remove(batch));
    }
    await run(() => this.#client.from(FILES_TABLE).delete().eq('project_id', id));
    await run(() => this.#client.from(PROJECTS_TABLE).delete().eq('id', id));
  }
}
