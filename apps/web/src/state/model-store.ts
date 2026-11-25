/**
 * The model as the renderer sees it: a mirror of the `CommandBus` project plus
 * renderer-only state (what is selected, what Claude is working on, a proposed structure).
 * The bus stays the only writer of the project; this store just follows it. The shell
 * store stays UI-only.
 */
import { create } from 'zustand';
import type { Aabb, Assembly, BusEventType, CatalogIndex, CommandBus, Part, Project } from '@slapdash/core';
import { modelBounds } from '../renderer/bounds.ts';
import { partLabel } from '../renderer/picking.ts';

/** A structure Claude proposes but hasn't built: drawn as a dashed orange box. */
export interface Proposal {
  footprint: { from: { x: number; z: number }; to: { x: number; z: number } };
  /** Height above the ground, mm. */
  height_mm: number;
  /** Base elevation, mm. Default 0. */
  base_mm?: number;
}

export interface ModelState {
  bus: CommandBus | null;
  project: Project | null;
  catalog: CatalogIndex | null;
  /** Bumped when a different bus is attached (a project opened): nothing animates then. */
  loadId: number;
  /** What changed the project last. Only `execute` (someone adding parts) animates. */
  lastEvent: BusEventType | 'load' | null;
  selectedPartId: string | null;
  /** "Header, South wall", for the chat chip. */
  selectedPartLabel: string | null;
  /** Parts Claude is working on right now: orange outlines. */
  inProgress: ReadonlySet<string>;
  proposal: Proposal | null;
}

export interface ModelActions {
  /** Follow a bus. Returns a function that stops following it. */
  attachBus: (bus: CommandBus) => () => void;
  select: (partId: string | null) => void;
  setInProgress: (ids: Iterable<string>) => void;
  /** Mark parts as in progress for `ms` (default 600), then clear them. */
  markInProgress: (ids: Iterable<string>, ms?: number) => void;
  setProposal: (proposal: Proposal | null) => void;
}

const EMPTY: ReadonlySet<string> = new Set();

export const initialModelState: ModelState = {
  bus: null,
  project: null,
  catalog: null,
  loadId: 0,
  lastEvent: null,
  selectedPartId: null,
  selectedPartLabel: null,
  inProgress: EMPTY,
  proposal: null,
};

/** Drop selection and in-progress ids whose parts no longer exist. */
function reconcile(state: ModelState, project: Project): Partial<ModelState> {
  const out: Partial<ModelState> = {};
  if (state.selectedPartId) {
    if (!project.parts[state.selectedPartId]) {
      out.selectedPartId = null;
      out.selectedPartLabel = null;
    } else {
      out.selectedPartLabel = partLabel(project, state.selectedPartId);
    }
  }
  if (state.inProgress.size > 0 && [...state.inProgress].some((id) => !project.parts[id])) {
    out.inProgress = new Set([...state.inProgress].filter((id) => project.parts[id]));
  }
  return out;
}

const timers = new Set<ReturnType<typeof setTimeout>>();

export const useModelStore = create<ModelState & ModelActions>()((set, get) => ({
  ...initialModelState,

  attachBus: (bus) => {
    set((s) => ({
      ...initialModelState,
      bus,
      project: bus.project,
      catalog: bus.catalog,
      loadId: s.loadId + 1,
      lastEvent: 'load',
    }));
    const off = bus.subscribe((project, event) => {
      if (get().bus !== bus) return;
      set((s) => ({ project, lastEvent: event.type, ...reconcile(s, project) }));
    });
    return () => {
      off();
      if (get().bus === bus) set({ bus: null });
    };
  },

  select: (partId) => {
    const project = get().project;
    if (partId !== null && !project?.parts[partId]) partId = null;
    set({ selectedPartId: partId, selectedPartLabel: partId && project ? partLabel(project, partId) : null });
  },

  setInProgress: (ids) => set({ inProgress: new Set(ids) }),

  markInProgress: (ids, ms = 600) => {
    const added = [...ids];
    if (added.length === 0) return;
    set((s) => ({ inProgress: new Set([...s.inProgress, ...added]) }));
    const timer = setTimeout(() => {
      timers.delete(timer);
      set((s) => {
        const next = new Set(s.inProgress);
        for (const id of added) next.delete(id);
        return { inProgress: next };
      });
    }, ms);
    timers.add(timer);
  },

  setProposal: (proposal) => set({ proposal }),
}));

/** Back to the initial state (tests). */
export function resetModelStore(): void {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  useModelStore.setState(initialModelState);
}

export function usePart(id: string | null): Part | undefined {
  return useModelStore((s) => (id ? s.project?.parts[id] : undefined));
}

export function useAssembly(id: string | null): Assembly | undefined {
  return useModelStore((s) => (id ? s.project?.assemblies[id] : undefined));
}

/** The build's bounds in mm (memoised per project), or null when there is nothing built. */
export function useProjectBounds(): Aabb | null {
  return useModelStore((s) => (s.project ? modelBounds(s.project) : null));
}
