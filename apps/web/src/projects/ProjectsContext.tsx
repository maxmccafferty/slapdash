import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectsController } from './projects-controller.ts';

/** What the shell calls: the Projects modal's actions. */
export type ProjectsActions = Pick<
  ProjectsController,
  'openProject' | 'newProject' | 'importFile' | 'openSample' | 'prepareList' | 'clearError' | 'signOut'
>;

const ProjectsContext = createContext<ProjectsActions | null>(null);

export function ProjectsProvider({ controller, children }: { controller: ProjectsActions; children: ReactNode }) {
  return <ProjectsContext.Provider value={controller}>{children}</ProjectsContext.Provider>;
}

/** Actions that do nothing, for rendering the shell without storage (component tests). */
const INERT: ProjectsActions = {
  openProject: async () => false,
  newProject: async () => {},
  importFile: async () => false,
  openSample: async () => false,
  prepareList: async () => {},
  clearError: () => {},
  signOut: async () => {},
};

export function useProjects(): ProjectsActions {
  return useContext(ProjectsContext) ?? INERT;
}
