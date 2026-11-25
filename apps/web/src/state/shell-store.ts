import { create } from 'zustand';

export type View = '3d' | '2d';
export type LookFrom = 'outside' | 'inside';
export type FloorId = 'roof' | 'floor-1' | 'foundation';
export type Panel = 'materials' | 'steps';
export type PhonePopover = 'project' | 'floors' | 'views';

/** UI state for the app shell only. Project data never lives here. */
export interface ShellState {
  view: View;
  lookFrom: LookFrom;
  dimensions: boolean;
  stress: boolean;
  floor: FloorId;
  /** The latched panel key (Materials or Steps). Mutually exclusive. */
  panel: Panel | null;
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
  togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
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
