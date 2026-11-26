/**
 * What the Projects modal shows: the stored projects, their card pictures, the open project,
 * and any error to explain. `projects-controller.ts` is the only writer.
 */
import { create } from 'zustand';
import type { ProjectSummary, SaveStatus, SyncStatus } from '@slapdash/storage';

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
  /** Sync with the cloud; null for the local-only app. */
  sync: SyncStatus | null;
  /** Who is signed in (hosted copy); null for the local-only app. */
  user: { email?: string; displayName: string } | null;
}

export const initialProjectsState: ProjectsState = {
  projects: [],
  thumbnails: {},
  currentId: null,
  busy: false,
  error: null,
  saveStatus: { kind: 'idle' },
  sync: null,
  user: null,
};

export const useProjectsStore = create<ProjectsState>()(() => ({ ...initialProjectsState }));

/** Back to the initial state (tests). */
export function resetProjectsStore(): void {
  useProjectsStore.setState(initialProjectsState, true);
}
