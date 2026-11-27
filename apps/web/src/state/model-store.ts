/**
 * The model as the renderer sees it: a mirror of the `CommandBus` project plus
 * renderer-only state (what is selected, what Claude is working on, a proposed structure).
 * The bus stays the only writer of the project; this store just follows it. The shell
 * store stays UI-only.
 */
import { create } from 'zustand';
import { isLegacyOpeningPanel, isUnitPart, unitLabel, unitOpeningId, unitPartsOf, type Aabb, type Assembly, type BusEventType, type CatalogIndex, type CommandBus, type Part, type Project } from '@slapdash/core';
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
  /** "Header, South wall", for the chat chip ("Casement window 3' × 4', Window in South wall" for a unit). */
  selectedPartLabel: string | null;
  /**
   * When the selected part is a piece of a window or door unit (or a pre-unit panel), its
   * opening (O1): the whole unit is outlined, and the chip and Claude refer to the opening.
   */
  selectedUnitId: string | null;
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
  selectedUnitId: null,
  inProgress: EMPTY,
  proposal: null,
};

/** The opening a part's unit belongs to, when it is a unit piece or a pre-unit panel. */
function unitOf(project: Project, part: Part): string | null {
  if (isUnitPart(part) || isLegacyOpeningPanel(project, part)) return unitOpeningId(part);
  return null;
}

/** Selection fields for a part (or nothing). */
export function selectionFor(project: Project | null, catalog: CatalogIndex | null, partId: string | null): Pick<ModelState, 'selectedPartId' | 'selectedPartLabel' | 'selectedUnitId'> {
  const part = partId && project && Object.hasOwn(project.parts, partId) ? project.parts[partId]! : null;
  if (!part || !project) return { selectedPartId: null, selectedPartLabel: null, selectedUnitId: null };
  const unit = unitOf(project, part);
  const label = (unit ? unitLabel(project, catalog ?? undefined, unit) : null) ?? partLabel(project, part.id);
  return { selectedPartId: part.id, selectedPartLabel: label, selectedUnitId: unit };
}

/**
 * Drop selection and in-progress ids whose parts no longer exist. A selected unit piece
 * that went (a re-size gave it a new ID) re-anchors to the unit's first part.
 */
function reconcile(state: ModelState, project: Project, catalog: CatalogIndex | null): Partial<ModelState> {
  const out: Partial<ModelState> = {};
  if (state.selectedPartId) {
    let id: string | null = state.selectedPartId;
    if (!project.parts[id]) id = state.selectedUnitId ? (unitPartsOf(project, state.selectedUnitId)[0]?.id ?? null) : null;
    Object.assign(out, selectionFor(project, catalog, id));
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
      set((s) => ({ project, lastEvent: event.type, ...reconcile(s, project, s.catalog) }));
    });
    return () => {
      off();
      if (get().bus === bus) set({ bus: null });
    };
  },

  select: (partId) => {
    set(selectionFor(get().project, get().catalog, partId));
  },

  setInProgress: (ids) => set({ inProgress: new Set(ids) }),

  // Long enough to cover one command's parts falling into place (renderer/entrances.ts:
  // WITHIN_ASSEMBLY_SPREAD_MS + ENTER_MS), so the landing outline stays until they land.
  markInProgress: (ids, ms = 1500) => {
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
