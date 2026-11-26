/** Project-level commands: things about the project as a whole rather than its parts. */
import { z } from 'zod';
import { zNonBlank } from './common.ts';
import { defineCommand } from './types.ts';

export const MAX_PROJECT_NAME_LENGTH = 120;

export const renameProject = defineCommand({
  name: 'rename_project',
  description: 'Rename the project. The name shows on the Projects screen and in exported file names.',
  exposed: true,
  schema: z.strictObject({
    name: zNonBlank('The new project name, e.g. "Pool house".').pipe(
      z.string().max(MAX_PROJECT_NAME_LENGTH, { error: `should be at most ${MAX_PROJECT_NAME_LENGTH} characters` }),
    ),
  }),
  check() {
    return [];
  },
  apply(project, input) {
    if (input.name === project.name) {
      return {
        project,
        inverse: [],
        redo: { name: 'rename_project', input: { name: input.name } },
        summary: `The project is already called "${input.name}".`,
        created: [],
      };
    }
    return {
      project: { ...project, name: input.name },
      inverse: [{ name: 'rename_project', input: { name: project.name } }],
      redo: { name: 'rename_project', input: { name: input.name } },
      summary: `Renamed the project to "${input.name}".`,
      created: [],
    };
  },
});

export const projectCommands = [renameProject];
