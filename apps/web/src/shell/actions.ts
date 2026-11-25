/**
 * The app-level actions the shell's keys call. They are no-ops for now; later tickets wire
 * them to the command bus (Undo, Redo) and the ProjectStore (Save, Load) in one place: App.tsx.
 */
export interface ShellActions {
  onSave: () => void;
  onLoad: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const noop = () => {};

export const NOOP_ACTIONS: ShellActions = { onSave: noop, onLoad: noop, onUndo: noop, onRedo: noop };
