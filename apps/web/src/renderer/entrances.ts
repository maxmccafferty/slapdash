/**
 * New parts fall from about a storey up into place and fade in from transparent. This is the schedule:
 * which parts are entering and when each one starts. `PartBatch` reads it every frame (instance
 * matrices and the `aEnter` attribute), and `Dimensions` holds new labels back until the parts
 * have landed. Nothing here touches React state, so an entrance never re-renders anything.
 *
 * Only parts a bus event adds during the session enter: an `execute`, or an undo, redo or
 * restore that brings parts back (showing what changed). Opening a project and the first render
 * of a scene are instant.
 *
 * A build that adds many parts is staggered by assembly, lowest first (slab, then walls one by
 * one, then the roof), and bottom-to-top within each assembly. The whole entrance stays under
 * `MAX_TOTAL_MS`. With reduced motion there is no fall and no stagger, only a quick fade.
 */
import type { Part, Project } from '@slapdash/core';
import { isContextPart, partAabb } from './bounds.ts';

/** One part's fall and fade. */
export const ENTER_MS = 900;
/** How far a part falls, metres. */
export const DROP_HEIGHT_M = 1.2;
/** The stagger between consecutive assemblies, capped by `MAX_ASSEMBLY_SPREAD_MS` in total. */
export const ASSEMBLY_STEP_MS = 300;
export const MAX_ASSEMBLY_SPREAD_MS = 1200;
/** Bottom-to-top spread inside one assembly. */
export const WITHIN_ASSEMBLY_SPREAD_MS = 500;
/** The longest a whole entrance takes, first start to last landing (2.6 s). */
export const MAX_TOTAL_MS = MAX_ASSEMBLY_SPREAD_MS + WITHIN_ASSEMBLY_SPREAD_MS + ENTER_MS;
/** With reduced motion: a quick fade, in place. */
export const REDUCED_FADE_MS = 150;
/** Dimension labels fade in over this once their parts have landed. */
export const LABEL_FADE_MS = 200;

export interface Entrance {
  /** performance.now() ms. */
  start: number;
  duration: number;
  /** Metres to fall. 0 with reduced motion. */
  drop: number;
}

export interface EntranceFrame {
  /** False until the part's start: it isn't drawn yet. */
  started: boolean;
  /** 0 (transparent) to 1. */
  opacity: number;
  /** Metres above its place. */
  lift: number;
  done: boolean;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Where an entering part is at `now`. */
export function entranceFrame(e: Entrance, now: number): EntranceFrame {
  const t = e.duration <= 0 ? 1 : (now - e.start) / e.duration;
  if (t < 0) return { started: false, opacity: 0, lift: e.drop, done: false };
  const k = Math.min(1, t);
  // The fade finishes a little before the landing, so the part is solid as it settles.
  return { started: true, opacity: easeOutCubic(Math.min(1, k / 0.7)), lift: e.drop * (1 - easeOutCubic(k)), done: k >= 1 };
}

export interface UpdateOptions {
  /** Changes when a different project is opened: that render is instant. */
  loadId: number;
  /** False for the event that loaded the project (or nothing yet). */
  animate: boolean;
  reducedMotion: boolean;
  now: number;
}

/**
 * Start times for newly added parts: assemblies in order of their lowest part (then id), and
 * parts bottom-to-top within each. Pure; exported for tests.
 */
export function planEntrances(added: readonly Part[], now: number, reducedMotion: boolean): Map<string, Entrance> {
  const out = new Map<string, Entrance>();
  if (added.length === 0) return out;
  if (reducedMotion) {
    for (const p of added) out.set(p.id, { start: now, duration: REDUCED_FADE_MS, drop: 0 });
    return out;
  }
  const byAssembly = new Map<string, { part: Part; bottom: number }[]>();
  for (const part of added) {
    let list = byAssembly.get(part.assemblyId);
    if (!list) byAssembly.set(part.assemblyId, (list = []));
    list.push({ part, bottom: partAabb(part).min.y });
  }
  const groups = [...byAssembly.entries()].map(([id, parts]) => ({ id, parts, bottom: Math.min(...parts.map((p) => p.bottom)) }));
  groups.sort((a, b) => a.bottom - b.bottom || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const step = groups.length > 1 ? Math.min(ASSEMBLY_STEP_MS, MAX_ASSEMBLY_SPREAD_MS / (groups.length - 1)) : 0;
  groups.forEach((g, gi) => {
    const lo = g.bottom;
    const hi = Math.max(...g.parts.map((p) => p.bottom));
    const spread = g.parts.length > 1 && hi > lo ? WITHIN_ASSEMBLY_SPREAD_MS : 0;
    for (const { part, bottom } of g.parts) {
      const y = spread > 0 ? (bottom - lo) / (hi - lo) : 0;
      out.set(part.id, { start: now + gi * step + y * spread, duration: ENTER_MS, drop: DROP_HEIGHT_M });
    }
  });
  return out;
}

/** The user's scene keeps one of these; snapshots don't have one (they never animate). */
export class EntranceSchedule {
  #prev: Project | null = null;
  #loadId: number | null = null;
  readonly #active = new Map<string, Entrance>();
  /** When the last update that added parts ran (performance.now ms), or -Infinity. */
  lastAddedAt = Number.NEGATIVE_INFINITY;
  /** When the last entering part lands. */
  landsAt = Number.NEGATIVE_INFINITY;
  /** As of the last update. */
  reducedMotion = false;

  /** Follow the project. Idempotent for the same project. */
  update(project: Project, opts: UpdateOptions): void {
    if (project === this.#prev && opts.loadId === this.#loadId) return;
    const prev = this.#prev;
    const sameProject = prev !== null && opts.loadId === this.#loadId;
    this.#prev = project;
    this.#loadId = opts.loadId;
    this.reducedMotion = opts.reducedMotion;
    if (!sameProject || !opts.animate) {
      // A project just opened (or the scene just mounted) appears at once.
      this.#active.clear();
      this.landsAt = Number.NEGATIVE_INFINITY;
      return;
    }
    // Parts that left stop entering; parts that came back (undo, redo, restore) enter again.
    for (const id of this.#active.keys()) if (!project.parts[id]) this.#active.delete(id);
    const added: Part[] = [];
    for (const part of Object.values(project.parts)) {
      if (!prev.parts[part.id] && !isContextPart(part)) added.push(part);
    }
    if (added.length === 0) return;
    for (const [id, e] of planEntrances(added, opts.now, opts.reducedMotion)) this.#active.set(id, e);
    this.lastAddedAt = opts.now;
    let end = Number.NEGATIVE_INFINITY;
    for (const e of this.#active.values()) end = Math.max(end, e.start + e.duration);
    this.landsAt = end;
  }

  /** Entrances still running at `now` (finished ones are dropped). */
  active(now: number): ReadonlyMap<string, Entrance> {
    for (const [id, e] of this.#active) if (now >= e.start + e.duration) this.#active.delete(id);
    return this.#active;
  }

  get size(): number {
    return this.#active.size;
  }
}

/**
 * Opacity for a dimension (line and label) that mounted at `mountedAt`. A measurement that
 * appeared with an entrance waits until the parts land, then fades in; any other one shows at
 * once. Pure; exported for tests.
 */
export function labelOpacity(schedule: Pick<EntranceSchedule, 'lastAddedAt' | 'landsAt' | 'reducedMotion'>, mountedAt: number, now: number): number {
  // The schedule updates in the scene's layout effect, just after the labels mount in the same commit.
  const cameWithEntrance = schedule.lastAddedAt >= mountedAt - 1 && schedule.lastAddedAt - mountedAt < 250;
  if (!cameWithEntrance) return 1;
  const fade = schedule.reducedMotion ? REDUCED_FADE_MS : LABEL_FADE_MS;
  return Math.max(0, Math.min(1, (now - schedule.landsAt) / fade));
}
