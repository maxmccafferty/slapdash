import { create } from 'zustand';

export type View = '3d' | '2d';
export type LookFrom = 'outside' | 'inside';
export type FloorId = 'roof' | 'floor-1' | 'foundation';
export type Panel = 'materials' | 'steps' | 'projects';
export type PhonePopover = 'project' | 'floors' | 'views';
export type MaterialsTab = 'materials' | 'cutlist';

/** UI state for the app shell only. Project data never lives here. */
export interface ShellState {
  view: View;
  lookFrom: LookFrom;
  dimensions: boolean;
  stress: boolean;
  floor: FloorId;
  /** The open panel (Materials, Steps or Projects). Mutually exclusive. */
  panel: Panel | null;
  /** The Build steps panel's current step (0-based). Reset when Steps opens or a project opens. */
  stepIndex: number;
  /** The Materials modal's tab. Kept here so it survives crossing the breakpoint. */
  materialsTab: MaterialsTab;
  phone: { popover: PhonePopover | null; chatOpen: boolean };
  /** The zoom readout, written by the 3D view (100% = the initial fit). There is no zoom control. */
  zoomPercent: number;
}

export interface ShellActions {
  setView: (view: View) => void;
  setLookFrom: (lookFrom: LookFrom) => void;
  setDimensions: (on: boolean) => void;
  toggleDimensions: () => void;
  setStress: (on: boolean) => void;
  toggleStress: () => void;
  setFloor: (floor: FloorId) => void;
  togglePanel: (panel: Panel) => void;
  closePanel: () => void;
  setStepIndex: (index: number) => void;
  /** Forward one step, up to the last of `count` steps. */
  nextStep: (count: number) => void;
  prevStep: () => void;
  setMaterialsTab: (tab: MaterialsTab) => void;
  openPopover: (popover: PhonePopover) => void;
  closePopover: () => void;
  setChatOpen: (open: boolean) => void;
  /** Close everything that only exists on the phone layout. */
  resetPhone: () => void;
  setZoomPercent: (percent: number) => void;
}

export const initialShellState: ShellState = {
  view: '3d',
  lookFrom: 'outside',
  dimensions: true,
  stress: false,
  floor: 'roof',
  panel: null,
  stepIndex: 0,
  materialsTab: 'materials',
  phone: { popover: null, chatOpen: false },
  zoomPercent: 100,
};

export const useShellStore = create<ShellState & ShellActions>()((set) => ({
  ...initialShellState,
  setView: (view) => set({ view }),
  setLookFrom: (lookFrom) => set({ lookFrom }),
  setDimensions: (dimensions) => set({ dimensions }),
  toggleDimensions: () => set((s) => ({ dimensions: !s.dimensions })),
  setStress: (stress) => set({ stress }),
  toggleStress: () => set((s) => ({ stress: !s.stress })),
  setFloor: (floor) => set({ floor }),
  togglePanel: (panel) =>
    set((s) => {
      const next = s.panel === panel ? null : panel;
      return next === 'steps' ? { panel: next, stepIndex: 0 } : { panel: next };
    }),
  closePanel: () => set({ panel: null }),
  setStepIndex: (index) => set({ stepIndex: Math.max(0, Math.floor(index)) }),
  nextStep: (count) => set((s) => ({ stepIndex: Math.max(0, Math.min(s.stepIndex + 1, count - 1)) })),
  prevStep: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  setMaterialsTab: (materialsTab) => set({ materialsTab }),
  openPopover: (popover) => set((s) => ({ phone: { ...s.phone, popover } })),
  closePopover: () => set((s) => ({ phone: { ...s.phone, popover: null } })),
  setChatOpen: (chatOpen) => set((s) => ({ phone: { popover: chatOpen ? null : s.phone.popover, chatOpen } })),
  resetPhone: () => set({ phone: { popover: null, chatOpen: false } }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
}));

/** Back to the initial state (tests). */
export function resetShellStore(): void {
  useShellStore.setState(initialShellState);
}
