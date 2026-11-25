import { z } from 'zod';
import { ASSEMBLY_ID, nextAssemblyId, reserveId } from '../model/ids.ts';
import { GROUND_LEVEL_ID } from '../model/create.ts';
import { jointsForParts, partsInAssembly } from '../model/queries.ts';
import { zAssemblyKind, zBuildStep, type Assembly } from '../model/schema.ts';
import { commandError, notFound, type CommandError } from './errors.ts';
import { checkExplicitId, exists, plural, zId, zNonBlank } from './common.ts';
import { putWithInverse, removeWithInverse } from './internal.ts';
import { defineCommand } from './types.ts';

export const addAssembly = defineCommand({
  name: 'add_assembly',
  description:
    'Create a named assembly (a group of parts such as "South wall" or "Roof"). Returns its ID, e.g. W2. Parts are added to an assembly with add_part.',
  exposed: true,
  schema: z.strictObject({
    name: zNonBlank('Readable name, e.g. "South wall".'),
    kind: zAssemblyKind.describe('What this assembly is. Sets the ID prefix (wall → W1, roof → R1, …).'),
    levelId: z.string().optional().describe('Level it sits on. Defaults to the ground level "L0".'),
    buildStep: zBuildStep.optional().describe('Construction phase for the assembly sequence.'),
    id: z.string().optional().describe('Explicit ID like "W3". Usually left out so one is chosen.'),
  }),
  check(project, input) {
    const errors: CommandError[] = [];
    const levelId = input.levelId ?? GROUND_LEVEL_ID;
    if (!project.levels.some((l) => l.id === levelId)) {
      errors.push(notFound('level', levelId, project.levels.map((l) => l.id), 'levelId'));
    }
    if (input.id !== undefined) {
      const err = checkExplicitId(project, 'assemblies', input.id, ASSEMBLY_ID, '"W2" or "R1"');
      if (err) errors.push(err);
    }
    return errors;
  },
  apply(project, input) {
    let counters = project.counters;
    let id = input.id;
    if (id === undefined) {
      ({ id, counters } = nextAssemblyId(counters, input.kind, (x) => exists(project.assemblies, x)));
    } else {
      counters = reserveId(counters, 'assembly', id);
    }
    const assembly: Assembly = { id, name: input.name, kind: input.kind, levelId: input.levelId ?? GROUND_LEVEL_ID };
    if (input.buildStep) assembly.buildStep = input.buildStep;
    const { project: next, inverse } = putWithInverse({ ...project, counters }, { assemblies: [assembly] });
    return {
      project: next,
      inverse,
      redo: { name: 'add_assembly', input: { ...input, id, levelId: assembly.levelId } },
      summary: `Added ${input.kind} ${id} "${input.name}".`,
      created: [id],
    };
  },
});

export const updateAssembly = defineCommand({
  name: 'update_assembly',
  description: 'Rename an assembly or change its build step. Its ID does not change.',
  exposed: true,
  schema: z.strictObject({
    id: zId('Assembly ID, e.g. "W2".'),
    name: zNonBlank('New name.').optional(),
    buildStep: zBuildStep.optional(),
  }),
  check(project, input) {
    if (!exists(project.assemblies, input.id)) {
      return [notFound('assembly', input.id, Object.keys(project.assemblies), 'id')];
    }
    if (input.name === undefined && input.buildStep === undefined) {
      return [commandError('invalid_input', 'Nothing to change: give "name" or "buildStep".')];
    }
    return [];
  },
  apply(project, input) {
    const prev = project.assemblies[input.id]!;
    const updated: Assembly = { ...prev };
    if (input.name !== undefined) updated.name = input.name;
    if (input.buildStep !== undefined) updated.buildStep = input.buildStep;
    const { project: next, inverse } = putWithInverse(project, { assemblies: [updated] });
    return {
      project: next,
      inverse,
      redo: { name: 'update_assembly', input },
      summary: `Updated ${input.id} "${updated.name}".`,
      created: [],
    };
  },
});

export const deleteAssembly = defineCommand({
  name: 'delete_assembly',
  description:
    'Delete an assembly. If it still has parts, pass withParts: true to delete them (and their joints) too.',
  exposed: true,
  schema: z.strictObject({
    id: zId('Assembly ID, e.g. "W2".'),
    withParts: z.boolean().optional().describe('Also delete every part in the assembly and their joints.'),
  }),
  check(project, input) {
    if (!exists(project.assemblies, input.id)) {
      return [notFound('assembly', input.id, Object.keys(project.assemblies), 'id')];
    }
    const count = partsInAssembly(project, input.id).length;
    if (count > 0 && !input.withParts) {
      return [
        commandError('not_allowed', `${input.id} still has ${plural(count, 'part')}.`, {
          path: 'withParts',
          hint: 'Pass withParts: true to delete them too.',
        }),
      ];
    }
    return [];
  },
  apply(project, input) {
    const parts = partsInAssembly(project, input.id).map((p) => p.id);
    const joints = jointsForParts(project, parts).map((j) => j.id);
    const { project: next, inverse } = removeWithInverse(project, { assemblies: [input.id], parts, joints });
    const extras: string[] = [];
    if (parts.length > 0) extras.push(plural(parts.length, 'part'));
    if (joints.length > 0) extras.push(plural(joints.length, 'joint'));
    return {
      project: next,
      inverse,
      redo: { name: 'delete_assembly', input },
      summary: `Deleted ${input.id}${extras.length > 0 ? ` with ${extras.join(' and ')}` : ''}.`,
      created: [],
    };
  },
});

export const assemblyCommands = [addAssembly, updateAssembly, deleteAssembly];
