/**
 * Runs one tool call and returns its result for Claude. Order: agent tools (snapshot, plan,
 * photo, preferences), queries, history, then bus commands. Every input is validated with
 * Zod; errors come back as plain sentences with `is_error`. No tool throws into the loop.
 */
import {
  formatErrors,
  historyToolDefs,
  zodIssuesToErrors,
  type CommandBus,
  type CommandError,
} from '@slapdash/core';
import type { z } from 'zod';
import { clip } from './format.ts';
import type { AgentMemory, StoredBlock } from './memory.ts';
import { INVALID_JSON_KEY } from './stream.ts';
import { QUERY_TOOLS } from './tools/queries.ts';
import { zProposePlan, zRequestPhoto, zSetPreferences } from './tools/schemas.ts';
import { SnapshotError, snapshotLabel, validateSnapshotRequest, type SnapshotProvider } from './tools/snapshot.ts';

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** The plan as the app draws it: lengths in millimetres. */
export interface PlanEvent {
  text: string;
  footprint?: { from: { x: number; z: number }; to: { x: number; z: number } };
  height_mm?: number;
}

/** What a call did, for the loop's bookkeeping and events. */
export interface ToolEffects {
  /** Ids a command created. */
  created?: string[];
  /** The change, for the folded summary of this turn. */
  changeSummary?: string;
  snapshot?: boolean;
  plan?: PlanEvent;
  photoRequest?: string;
  prefs?: { confirmBigChanges: boolean };
}

export interface ToolOutcome {
  content: string | StoredBlock[];
  isError: boolean;
  effects: ToolEffects;
}

export interface DispatchContext {
  bus: CommandBus;
  memory: AgentMemory;
  snapshot?: SnapshotProvider;
}

export const NO_SNAPSHOT_MESSAGE = "Snapshots aren't available here; use measure and find_parts.";
const MAX_CREATED_LISTED = 40;

const ok = (content: string | StoredBlock[], effects: ToolEffects = {}): ToolOutcome => ({ content, isError: false, effects });
const fail = (errors: readonly CommandError[] | string, suffix = ''): ToolOutcome => ({
  content: (typeof errors === 'string' ? errors : formatErrors(errors)) + suffix,
  isError: true,
  effects: {},
});

function parse<S extends z.ZodType>(schema: S, raw: unknown): { ok: true; data: z.output<S> } | { ok: false; out: ToolOutcome } {
  const res = schema.safeParse(raw ?? {});
  return res.success ? { ok: true, data: res.data } : { ok: false, out: fail(zodIssuesToErrors(res.error.issues, raw)) };
}

const HISTORY = new Map<string, z.ZodType>(historyToolDefs.map((d) => [d.name, d.schema]));

function listCreated(created: readonly string[]): string {
  if (created.length === 0) return '';
  const shown = created.slice(0, MAX_CREATED_LISTED);
  const more = created.length - shown.length;
  return `\nCreated: ${shown.join(', ')}${more > 0 ? ` …and ${more} more (use find_parts)` : ''}.`;
}

function runHistory(name: string, input: Record<string, unknown>, bus: CommandBus): ToolOutcome {
  switch (name) {
    case 'undo':
    case 'redo': {
      const res = name === 'undo' ? bus.undo() : bus.redo();
      return res.ok ? ok(res.summary, { changeSummary: res.summary }) : fail(res.errors);
    }
    case 'list_history': {
      const items = bus.listHistory(typeof input.limit === 'number' ? input.limit : undefined);
      if (items.length === 0) return ok('No changes yet.');
      return ok(items.map((i) => `#${i.id} ${i.source}${i.isUndone ? ' (undone, can redo)' : ''}: ${clip(i.label, 120)}`).join('\n'));
    }
    case 'save_version': {
      const res = bus.saveVersion(String(input.name), typeof input.note === 'string' ? input.note : undefined);
      return res.ok ? ok(res.summary) : fail(res.errors);
    }
    case 'list_versions': {
      const items = bus.listVersions();
      if (items.length === 0) return ok('No saved versions yet.');
      return ok(items.map((v) => `"${v.name}" · ${v.partCount} parts${v.note ? ` · ${v.note}` : ''}`).join('\n'));
    }
    case 'restore_version': {
      const res = bus.restoreVersion(String(input.name));
      return res.ok ? ok(res.summary, { changeSummary: res.summary }) : fail(res.errors);
    }
    default:
      return fail(`There's no history tool "${name}".`);
  }
}

async function runSnapshot(input: unknown, ctx: DispatchContext): Promise<ToolOutcome> {
  const checked = validateSnapshotRequest(input, ctx.bus.project);
  if (!checked.ok) return fail(checked.errors);
  if (!ctx.snapshot) return fail(NO_SNAPSHOT_MESSAGE);
  try {
    const img = await ctx.snapshot(checked.request);
    const label = snapshotLabel(checked.request);
    const notes = img.notes.length > 0 ? ` ${img.notes.join(' ')}` : '';
    return ok(
      [
        { type: 'slapdash_snapshot', label, image: { media_type: 'image/png', data: img.data } },
        { type: 'text', text: `Snapshot: ${label}, ${img.width}×${img.height}.${notes} Images are for noticing; measure for exact numbers.` },
      ],
      { snapshot: true },
    );
  } catch (e) {
    if (e instanceof SnapshotError) return fail(e.errors);
    return fail(`The snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function run(call: ToolCall, ctx: DispatchContext): Promise<ToolOutcome> {
  const { name, input } = call;
  if (input !== null && typeof input === 'object' && INVALID_JSON_KEY in input) {
    const raw = String((input as Record<string, unknown>)[INVALID_JSON_KEY]);
    return fail(`Your input for ${name} wasn't valid JSON: ${clip(raw, 200)} Nothing has changed.`);
  }

  switch (name) {
    case 'snapshot':
      return runSnapshot(input, ctx);
    case 'propose_plan': {
      const p = parse(zProposePlan, input);
      if (!p.ok) return p.out;
      const plan: PlanEvent = { text: p.data.plan };
      if (p.data.footprint) plan.footprint = p.data.footprint;
      if (p.data.height !== undefined) plan.height_mm = p.data.height;
      return ok(
        'The plan is on screen with Build it and Change something. Stop here: end your turn with the plan in a sentence and wait for the answer.',
        { plan },
      );
    }
    case 'request_photo': {
      const p = parse(zRequestPhoto, input);
      if (!p.ok) return p.out;
      return ok(`The person has been asked for a photo of ${p.data.what}. Stop here and wait; it will come with their next message.`, {
        photoRequest: p.data.what,
      });
    }
    case 'set_preferences': {
      const p = parse(zSetPreferences, input);
      if (!p.ok) return p.out;
      ctx.memory.setPrefs(p.data);
      return ok(
        p.data.confirmBigChanges
          ? 'Big-change check is on: show a plan with propose_plan before big changes.'
          : 'Big-change check is off for this project: build without a plan first. The person can ask for plans again any time.',
        { prefs: p.data },
      );
    }
  }

  const query = QUERY_TOOLS[name];
  if (query) {
    const res = query(ctx.bus.project, ctx.bus.catalog, input);
    return res.ok ? ok(res.text) : fail(res.errors);
  }

  const historySchema = HISTORY.get(name);
  if (historySchema) {
    const p = parse(historySchema, input);
    if (!p.ok) return p.out;
    return runHistory(name, p.data as Record<string, unknown>, ctx.bus);
  }

  const res = ctx.bus.execute(name, input);
  if (!res.ok) return fail(res.errors, '\nNothing has changed.');
  return ok(res.summary + listCreated(res.created), { created: res.created, changeSummary: res.summary });
}

export async function dispatchTool(call: ToolCall, ctx: DispatchContext): Promise<ToolOutcome> {
  try {
    return await run(call, ctx);
  } catch (e) {
    return fail(`Something went wrong running ${call.name}; nothing was changed. (${e instanceof Error ? e.message : String(e)})`);
  }
}
