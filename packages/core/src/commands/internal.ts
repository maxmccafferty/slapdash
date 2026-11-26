/**
 * Internal commands used to build inverses. They restore entities exactly (including
 * cascaded joints) and are never exposed to Claude, so they skip semantic checks.
 */
import { z } from 'zod';
import { mergeCounters, type IdCounters } from '../model/ids.ts';
import type { Assembly, Joint, Part, Project, SiteSettings } from '../model/schema.ts';
import { defineCommand, type AppliedCommand } from './types.ts';

export interface EntitySnapshots {
  assemblies?: Assembly[];
  parts?: Part[];
  joints?: Joint[];
}

export interface EntityIds {
  assemblies?: string[];
  parts?: string[];
  joints?: string[];
}

type Table = 'assemblies' | 'parts' | 'joints';
const TABLES: readonly Table[] = ['assemblies', 'parts', 'joints'];

type AnyEntity = Assembly | Part | Joint;

function has(record: Record<string, unknown>, id: string): boolean {
  return Object.hasOwn(record, id);
}

/** Build the inverse commands for a set of upserts against `before`. */
function inverseOfPut(before: Project, snapshots: EntitySnapshots): AppliedCommand[] {
  const restore: EntitySnapshots = {};
  const remove: EntityIds = {};
  for (const t of TABLES) {
    const list = (snapshots[t] ?? []) as AnyEntity[];
    const record = before[t] as Record<string, AnyEntity>;
    const prev = list.filter((e) => has(record, e.id)).map((e) => record[e.id]!);
    const added = list.filter((e) => !has(record, e.id)).map((e) => e.id);
    if (prev.length > 0) (restore[t] as AnyEntity[]) = prev;
    if (added.length > 0) remove[t] = added;
  }
  const out: AppliedCommand[] = [];
  if (Object.keys(restore).length > 0) out.push({ name: 'put_entities', input: restore });
  if (Object.keys(remove).length > 0) out.push({ name: 'remove_entities', input: remove });
  return out;
}

/** Upsert entities into a project (pure). */
export function putEntities(project: Project, snapshots: EntitySnapshots): Project {
  let next = project;
  for (const t of TABLES) {
    const list = snapshots[t];
    if (!list || list.length === 0) continue;
    const record: Record<string, AnyEntity> = { ...(next[t] as Record<string, AnyEntity>) };
    for (const e of list) record[e.id] = e;
    next = { ...next, [t]: record };
  }
  return next;
}

/** Remove entities from a project by id (pure). Missing ids are ignored. */
export function removeEntities(project: Project, ids: EntityIds): Project {
  let next = project;
  for (const t of TABLES) {
    const list = ids[t];
    if (!list || list.length === 0) continue;
    const record: Record<string, AnyEntity> = { ...(next[t] as Record<string, AnyEntity>) };
    for (const id of list) delete record[id];
    next = { ...next, [t]: record };
  }
  return next;
}

/** Inverse + redo bookkeeping for "put these entities", shared by many commands. */
export function putWithInverse(before: Project, snapshots: EntitySnapshots) {
  return { project: putEntities(before, snapshots), inverse: inverseOfPut(before, snapshots) };
}

/** Inverse bookkeeping for "remove these entities". */
export function removeWithInverse(before: Project, ids: EntityIds) {
  const restore: EntitySnapshots = {};
  for (const t of TABLES) {
    const record = before[t] as Record<string, AnyEntity>;
    const prev = (ids[t] ?? []).filter((id) => has(record, id)).map((id) => record[id]!);
    if (prev.length > 0) (restore[t] as AnyEntity[]) = prev;
  }
  const inverse: AppliedCommand[] =
    Object.keys(restore).length > 0 ? [{ name: 'put_entities', input: restore }] : [];
  return { project: removeEntities(before, ids), inverse };
}

export const putEntitiesCommand = defineCommand({
  name: 'put_entities',
  description: 'Internal: insert or replace entities exactly as given.',
  exposed: false,
  schema: z.custom<EntitySnapshots>((v) => typeof v === 'object' && v !== null),
  check: () => [],
  apply(project, input) {
    const { project: next, inverse } = putWithInverse(project, input);
    return { project: next, inverse, redo: { name: 'put_entities', input }, summary: 'Restored entities.', created: [] };
  },
});

export const removeEntitiesCommand = defineCommand({
  name: 'remove_entities',
  description: 'Internal: remove entities by id, with no cascade.',
  exposed: false,
  schema: z.custom<EntityIds>((v) => typeof v === 'object' && v !== null),
  check: () => [],
  apply(project, input) {
    const { project: next, inverse } = removeWithInverse(project, input);
    return { project: next, inverse, redo: { name: 'remove_entities', input }, summary: 'Removed entities.', created: [] };
  },
});

export interface EntityPatch {
  /** Entities to insert or replace, applied after `remove`. */
  put?: EntitySnapshots;
  /** Entities to remove (no cascade). */
  remove?: EntityIds;
  /** ID counters to merge in (only ever moves them forward). */
  counters?: IdCounters;
}

function isEmptyIds(ids: EntityIds | undefined): boolean {
  return !ids || TABLES.every((t) => (ids[t] ?? []).length === 0);
}

/**
 * Remove then put, in one step, with a single `patch_entities` inverse that restores
 * every removed or overwritten entity and removes every newly added one. Builders use
 * this: their redo is the resulting patch, so re-applying it after an undo recreates
 * exactly the same IDs.
 */
export function patchWithInverse(before: Project, patch: EntityPatch): { project: Project; inverse: AppliedCommand[] } {
  const put = patch.put ?? {};
  const restore: EntitySnapshots = {};
  const remove: EntityIds = {};
  for (const t of TABLES) {
    const record = before[t] as Record<string, AnyEntity>;
    const putIds = new Set(((put[t] ?? []) as AnyEntity[]).map((e) => e.id));
    const touched = new Set([...(patch.remove?.[t] ?? []), ...putIds]);
    const prev = [...touched].filter((id) => has(record, id)).map((id) => record[id]!);
    const added = [...putIds].filter((id) => !has(record, id));
    if (prev.length > 0) (restore[t] as AnyEntity[]) = prev;
    if (added.length > 0) remove[t] = added;
  }
  let project = removeEntities(before, patch.remove ?? {});
  project = putEntities(project, put);
  if (patch.counters) project = { ...project, counters: mergeCounters(project.counters, patch.counters) };
  const inversePatch: EntityPatch = {};
  if (Object.keys(restore).length > 0) inversePatch.put = restore;
  if (!isEmptyIds(remove)) inversePatch.remove = remove;
  const inverse: AppliedCommand[] =
    inversePatch.put || inversePatch.remove ? [{ name: 'patch_entities', input: inversePatch }] : [];
  return { project, inverse };
}

export const patchEntitiesCommand = defineCommand({
  name: 'patch_entities',
  description: 'Internal: remove some entities and put others, as one step. Used as the redo of builder tools.',
  exposed: false,
  schema: z.custom<EntityPatch>((v) => typeof v === 'object' && v !== null),
  check: () => [],
  apply(project, input) {
    const { project: next, inverse } = patchWithInverse(project, input);
    return { project: next, inverse, redo: { name: 'patch_entities', input }, summary: 'Applied a set of changes.', created: [] };
  },
});

export const setSiteCommand = defineCommand({
  name: 'set_site',
  description: 'Internal: replace the site settings.',
  exposed: false,
  schema: z.custom<{ site: SiteSettings }>((v) => typeof v === 'object' && v !== null),
  check: () => [],
  apply(project, input) {
    return {
      project: { ...project, site: input.site },
      inverse: [{ name: 'set_site', input: { site: project.site } }],
      redo: { name: 'set_site', input },
      summary: 'Updated site settings.',
      created: [],
    };
  },
});

/**
 * Replace the whole project (used by restore_version). ID counters are merged, never
 * rolled back, so IDs used after the restored version are not handed out again.
 */
export const replaceProjectCommand = defineCommand({
  name: 'replace_project',
  description: 'Internal: replace the whole project.',
  exposed: false,
  schema: z.custom<{ project: Project }>((v) => typeof v === 'object' && v !== null),
  check: () => [],
  apply(project, input) {
    const next: Project = { ...input.project, counters: mergeCounters(project.counters, input.project.counters) };
    return {
      project: next,
      inverse: [{ name: 'replace_project', input: { project } }],
      redo: { name: 'replace_project', input },
      summary: `Replaced the project with a saved copy.`,
      created: [],
    };
  },
});

export const internalCommands = [putEntitiesCommand, removeEntitiesCommand, patchEntitiesCommand, setSiteCommand, replaceProjectCommand];
