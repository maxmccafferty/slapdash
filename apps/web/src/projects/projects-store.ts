/**
 * What the Projects modal shows: the stored projects, their card pictures, the open project,
 * and any error to explain. `projects-controller.ts` is the only writer.
 */
import { create } from 'zustand';
import type { ProjectSummary, SaveStatus } from '@slapdash/storage';

export interface ProjectsState {
  /** Stored projects, newest first. */
  projects: ProjectSummary[];
  /** Object URLs of card pictures, by project id. Revoked when replaced. */
  thumbnails: Record<string, string>;
  /** The open project's id (it may not be stored yet). */
  currentId: string | null;
  /** Opening, importing or listing. */
  busy: boolean;
  /** A plain sentence for the modal's status line. */
  error: string | null;
  saveStatus: SaveStatus;
}

export const initialProjectsState: ProjectsState = {
  projects: [],
  thumbnails: {},
  currentId: null,
  busy: false,
  error: null,
  saveStatus: { kind: 'idle' },
};

export const useProjectsStore = create<ProjectsState>()(() => ({ ...initialProjectsState }));

/** Back to the initial state (tests). */
export function resetProjectsStore(): void {
  useProjectsStore.setState(initialProjectsState, true);
}
