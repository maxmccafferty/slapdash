/**
 * The app-level actions the shell's keys call, wired in one place: `main.tsx`. Save saves the
 * open project now (`ProjectsController.save`) and Load opens the Projects modal. Undo and
 * Redo are still no-ops here. Component tests use `NOOP_ACTIONS`.
 */
export interface ShellActions {
  onSave: () => void;
  onLoad: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const noop = () => {};

export const NOOP_ACTIONS: ShellActions = { onSave: noop, onLoad: noop, onUndo: noop, onRedo: noop };
