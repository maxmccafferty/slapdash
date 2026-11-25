/**
 * The 2D view's pan and zoom. Kept outside the component so switching 3D → 2D → 3D → 2D
 * keeps the user's view.
 */
import { create } from 'zustand';
import type { ViewState } from './pan-zoom.ts';

export interface SheetViewStore {
  state: ViewState | null;
  /** The fitted view for the current viewport (100%). */
  fit: ViewState | null;
  /** `${loadId}:${hasParts}` of the last fit: refit only when a project is opened or first gets parts. */
  fittedFor: string | null;
  set: (state: ViewState) => void;
  setFit: (fit: ViewState, fittedFor?: string) => void;
  reset: () => void;
}

export const useSheetViewStore = create<SheetViewStore>()((set) => ({
  state: null,
  fit: null,
  fittedFor: null,
  set: (state) => set({ state }),
  setFit: (fit, fittedFor) => set((s) => ({ fit, fittedFor: fittedFor ?? s.fittedFor })),
  reset: () => set({ state: null, fit: null, fittedFor: null }),
}));
