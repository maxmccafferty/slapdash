import { z } from 'zod';
import type { CatalogIndex } from '../catalog/validate.ts';
import type { Material, Section } from '../catalog/schema.ts';
import { add } from '../geometry/vec3.ts';
import { PART_ID, nextPartId, reserveId, type AssemblyKind } from '../model/ids.ts';
import { jointsForPart, jointsForParts } from '../model/queries.ts';
import {
  zBuildStep,
  zEndCut,
  zPartRole,
  type Assembly,
  type BuildPhase,
  type BuildStep,
  type Part,
  type PartCuts,
  type PartSize,
  type Project,
} from '../model/schema.ts';
import { describeCuts, hasCuts, validateCuts } from '../geometry/cuts.ts';
import { formatBoth } from '../units/length.ts';
import { LENGTH_DESCRIPTION, zLength, zPositiveLength, zVec3Input } from '../units/zod.ts';
import { commandError, notFound, type CommandError } from './errors.ts';
import { checkElevation, checkExplicitId, exists, plural, quoteList, zId, zIdList } from './common.ts';
import { putWithInverse, removeWithInverse } from './internal.ts';
import { defineCommand } from './types.ts';

/** Default build phase for parts in each kind of assembly. */
export const PHASE_FOR_KIND: Record<AssemblyKind, BuildPhase> = {
  foundation: 'foundation',
  floor: 'floor',
  wall: 'framing',
  roof: 'roofing',
  opening: 'openings',
  structure: 'framing',
  site: 'site',
  misc: 'finish',
};

function defaultBuildStep(assembly: Assembly): BuildStep {
  return assembly.buildStep ?? { phase: PHASE_FOR_KIND[assembly.kind] };
}

const zRotationInput = z
  .strictObject({
    x: z.number().optional().describe('Degrees about x.'),
    y: z.number().optional().describe('Degrees about y (turning in plan).'),
    z: z.number().optional().describe('Degrees about z.'),
  })
  .describe('Rotation in degrees, applied in X, then Y, then Z order. Missing axes are 0.');

const SIZE_TOLERANCE_MM = 0.5;

const zEndCutInput = z.strictObject({
  slope: zEndCut.shape.slope.describe(
    'Degrees from square through the depth (about local y; on an edge, about local x), between −80 and 80. > 0 puts the long point on the bottom face (z = 0), < 0 on the top face.',
  ),
  miter: zEndCut.shape.miter.describe('Start/end only. Degrees from square through the width (about local z). > 0 puts the long point on the y = 0 face.'),
  name: zEndCut.shape.name.describe('The cut-list word: plumb, level, bevel, miter or trim.'),
});

/** Tool input for `Part.cuts`: like the model's, but notch points take lengths with units. */
export const zCutsInput = z
  .strictObject({
    start: zEndCutInput.optional().describe('Cut at local x = 0.'),
    end: zEndCutInput.optional().describe('Cut at local x = length.'),
    nearEdge: zEndCutInput.optional().describe('Cut along the local y = 0 edge (slope only), e.g. a sheet bevel.'),
    farEdge: zEndCutInput.optional().describe('Cut along the local y = width edge (slope only).'),
    notches: z
      .array(
        z.strictObject({
          kind: z.enum(['birdsmouth', 'trim', 'notch']),
          profile: z
            .array(z.strictObject({ x: zLength.describe('Along the part (local x).'), z: zLength.describe('Through the depth (local z).') }))
            .min(3)
            .max(8)
            .describe('A convex polygon in the part\'s local x–z, cut through its full width. It may reach past the faces it cuts; a birdsmouth is [heel exit, inner corner, seat exit].'),
        }),
      )
      .max(4)
      .optional(),
  })
  .describe(
    "Angled end cuts and notches, so a sloped member sits flush. A rafter at pitch θ = atan(rise/12): start {slope: θ, name: 'plumb'}, end {slope: −θ, name: 'plumb'}; length is the long point.",
  );

function cutsError(size: PartSize, cuts: PartCuts | undefined, path = 'cuts', hint?: string): CommandError | null {
  const why = validateCuts(size, cuts);
  return why ? commandError('invalid_input', why, { path, ...(hint ? { hint } : {}) }) : null;
}

function describePart(part: Part, catalog: CatalogIndex): string {
  const material = catalog.materials.get(part.materialId)?.name ?? part.materialId;
  const section = part.sectionId ? ` ${catalog.sections.get(part.sectionId)?.name ?? part.sectionId}` : '';
  const cuts = hasCuts(part) ? `, ${describeCuts(part).label}` : '';
  return `${part.role} ${part.id} (${material}${section}, ${formatBoth(part.size.length)} long${hasCuts(part) && describeCuts(part).longPoint ? ' to the long point' : ''}${cuts})`;
}

function sectionFitsMaterial(section: Section, material: Material, path: string): CommandError | null {
  if (section.materialCategories.includes(material.category)) return null;
  return commandError(
    'invalid_input',
    `A ${section.name} section comes in ${section.materialCategories.join(' or ')}, but ${material.name} is ${material.category}.`,
    { path },
  );
}

/** Joints on this part whose type the material can't take. */
function incompatibleJoints(project: Project, partId: string, material: Material) {
  return jointsForPart(project, partId).filter((j) => !material.acceptsJoints.includes(j.jointTypeId));
}

export const addPart = defineCommand({
  name: 'add_part',
  description:
    'Add one part (a stud, joist, sheet, slab…) to an assembly. Give a material and either a sectionId (e.g. 2x4, which sets width and height) or explicit width and height. Lengths accept numbers in mm or a string with a unit, e.g. 8ft, without extra quote marks. Position is the part\'s start corner; the part runs along its local x axis.',
  exposed: true,
  schema: z.strictObject({
    assemblyId: zId.describe('Assembly to add to, e.g. W2.'),
    role: zPartRole.describe('What the part does. Sets the ID code (stud → S, joist → J, …).'),
    materialId: zId.describe('Catalog material ID, e.g. spf-no2.'),
    sectionId: zId.optional().describe('Catalog section ID, e.g. 2x4. Sets width and height.'),
    position: zVec3Input.describe('Start corner of the part, from the ground origin; y is up.'),
    rotation: zRotationInput.optional(),
    length: zPositiveLength.describe(`Length along the part (local x). ${LENGTH_DESCRIPTION}`),
    width: zPositiveLength.optional().describe(`Width (local y). Only when there is no sectionId. ${LENGTH_DESCRIPTION}`),
    height: zPositiveLength
      .optional()
      .describe(`Height or thickness (local z). Only when there is no sectionId. ${LENGTH_DESCRIPTION}`),
    cuts: zCutsInput.optional(),
    buildStep: zBuildStep.optional(),
    name: z.string().optional().describe('Optional readable name.'),
    tags: z.array(z.string()).optional().describe('Free-form tags.'),
    id: zId.optional().describe('Explicit ID like W2-S07. Usually left out so one is chosen.'),
  }),
  check(project, input, ctx) {
    const errors: CommandError[] = [];
    if (!exists(project.assemblies, input.assemblyId)) {
      errors.push(notFound('assembly', input.assemblyId, Object.keys(project.assemblies), 'assemblyId'));
    }
    const material = ctx.catalog.materials.get(input.materialId);
    if (!material) errors.push(notFound('material', input.materialId, ctx.catalog.materials.keys(), 'materialId'));

    if (input.sectionId !== undefined) {
      const section = ctx.catalog.sections.get(input.sectionId);
      if (!section) {
        errors.push(notFound('section', input.sectionId, ctx.catalog.sections.keys(), 'sectionId'));
      } else {
        if (material) {
          const err = sectionFitsMaterial(section, material, 'sectionId');
          if (err) errors.push(err);
        }
        const dims = { width: section.dims_mm.width, height: section.dims_mm.depth };
        for (const key of ['width', 'height'] as const) {
          const given = input[key];
          if (given !== undefined && Math.abs(given - dims[key]) > SIZE_TOLERANCE_MM) {
            errors.push(
              commandError(
                'invalid_input',
                `A ${section.name} is ${formatBoth(dims[key])} in ${key}, but you gave ${formatBoth(given)}.`,
                { path: key, hint: `Leave "${key}" out when using a section.` },
              ),
            );
          }
        }
      }
    } else {
      const missing = (['width', 'height'] as const).filter((k) => input[k] === undefined);
      if (missing.length > 0) {
        errors.push(
          commandError('invalid_input', `Give ${missing.map((k) => `"${k}"`).join(' and ')}, or a "sectionId" such as "2x4".`, {
            path: missing[0]!,
          }),
        );
      }
    }

    const low = checkElevation(input.position.y, 'position.y', 'The part');
    if (low) errors.push(low);

    if (input.cuts !== undefined) {
      const section = input.sectionId !== undefined ? ctx.catalog.sections.get(input.sectionId) : undefined;
      const width = section ? section.dims_mm.width : input.width;
      const height = section ? section.dims_mm.depth : input.height;
      if (width !== undefined && height !== undefined) {
        const err = cutsError({ length: input.length, width, height }, input.cuts);
        if (err) errors.push(err);
      }
    }

    if (input.id !== undefined) {
      const err = checkExplicitId(project, 'parts', input.id, PART_ID, '"W2-S07"');
      if (err) errors.push(err);
      else if (!input.id.startsWith(`${input.assemblyId}-`)) {
        errors.push(
          commandError('invalid_input', `Part ID "${input.id}" must start with its assembly, "${input.assemblyId}-".`, {
            path: 'id',
          }),
        );
      }
    }
    return errors;
  },
  apply(project, input, ctx) {
    const assembly = project.assemblies[input.assemblyId]!;
    const section = input.sectionId !== undefined ? ctx.catalog.sections.get(input.sectionId) : undefined;
    let counters = project.counters;
    let id = input.id;
    if (id === undefined) {
      ({ id, counters } = nextPartId(counters, input.assemblyId, input.role, (x) => exists(project.parts, x)));
    } else {
      counters = reserveId(counters, 'part', id);
    }
    const part: Part = {
      id,
      assemblyId: input.assemblyId,
      levelId: assembly.levelId,
      role: input.role,
      materialId: input.materialId,
      position: { ...input.position },
      rotation: { x: input.rotation?.x ?? 0, y: input.rotation?.y ?? 0, z: input.rotation?.z ?? 0 },
      size: {
        length: input.length,
        width: section ? section.dims_mm.width : input.width!,
        height: section ? section.dims_mm.depth : input.height!,
      },
      buildStep: input.buildStep ?? defaultBuildStep(assembly),
      tags: input.tags ?? [],
    };
    if (input.name !== undefined) part.name = input.name;
    if (input.sectionId !== undefined) part.sectionId = input.sectionId;
    if (input.cuts !== undefined && hasCuts(input)) part.cuts = input.cuts;

    const { project: next, inverse } = putWithInverse({ ...project, counters }, { parts: [part] });
    const redoInput: Record<string, unknown> = {
      assemblyId: part.assemblyId,
      role: part.role,
      materialId: part.materialId,
      position: part.position,
      rotation: part.rotation,
      length: part.size.length,
      buildStep: part.buildStep,
      tags: part.tags,
      id,
    };
    if (section) redoInput.sectionId = part.sectionId;
    else {
      redoInput.width = part.size.width;
      redoInput.height = part.size.height;
    }
    if (part.name !== undefined) redoInput.name = part.name;
    if (part.cuts !== undefined) redoInput.cuts = part.cuts;
    return {
      project: next,
      inverse,
      redo: { name: 'add_part', input: redoInput },
      summary: `Added ${describePart(part, ctx.catalog)}.`,
      created: [id],
    };
  },
});

export const moveParts = defineCommand({
  name: 'move_parts',
  description:
    'Move one or more parts. Use "by" to shift every listed part by the same offset, or "to" to put a single part\'s start corner at a point. "rotation" sets the listed axes to absolute angles.',
  exposed: true,
  schema: z.strictObject({
    ids: zIdList('Part IDs to move, e.g. W2-S07.'),
    to: zVec3Input.optional().describe('New start corner (one part only).'),
    by: zVec3Input.optional().describe('Offset to add to each part\'s position.'),
    rotation: zRotationInput.optional(),
  }),
  check(project, input) {
    const missing = input.ids.filter((id) => !exists(project.parts, id));
    if (missing.length === 1) return [notFound('part', missing[0]!, Object.keys(project.parts), 'ids')];
    if (missing.length > 1) {
      return [commandError('not_found', `These parts don't exist: ${quoteList(missing)}.`, { path: 'ids' })];
    }
    if (input.to && input.by) {
      return [commandError('invalid_input', 'Give either "to" or "by", not both.')];
    }
    if (!input.to && !input.by && !input.rotation) {
      return [commandError('invalid_input', 'Nothing to change: give "to", "by" or "rotation".')];
    }
    if (input.to && input.ids.length > 1) {
      return [
        commandError('invalid_input', `"to" moves a single part, but you listed ${input.ids.length}.`, {
          path: 'to',
          hint: 'Use "by" to shift several parts together.',
        }),
      ];
    }
    const errors: CommandError[] = [];
    for (const id of input.ids) {
      const p = project.parts[id]!;
      const y = input.to ? input.to.y : input.by ? p.position.y + input.by.y : p.position.y;
      const err = checkElevation(y, input.to ? 'to.y' : 'by.y', id);
      if (err) errors.push(err);
    }
    return errors;
  },
  apply(project, input) {
    const updated = input.ids.map((id) => {
      const prev = project.parts[id]!;
      const position = input.to ? { ...input.to } : input.by ? add(prev.position, input.by) : prev.position;
      const rotation = input.rotation
        ? {
            x: input.rotation.x ?? prev.rotation.x,
            y: input.rotation.y ?? prev.rotation.y,
            z: input.rotation.z ?? prev.rotation.z,
          }
        : prev.rotation;
      return { ...prev, position, rotation };
    });
    const { project: next, inverse } = putWithInverse(project, { parts: updated });
    const what = input.ids.length === 1 ? input.ids[0]! : plural(input.ids.length, 'part');
    const how = input.to || input.by ? 'Moved' : 'Rotated';
    return { project: next, inverse, redo: { name: 'move_parts', input }, summary: `${how} ${what}.`, created: [] };
  },
});

export const resizePart = defineCommand({
  name: 'resize_part',
  description:
    'Change a part\'s length, or the width/height of a part with no section. To change a sectioned member\'s size, give it a different section with update_part.',
  exposed: true,
  schema: z.strictObject({
    id: zId.describe('Part ID, e.g. W2-S07.'),
    length: zPositiveLength.optional(),
    width: zPositiveLength.optional(),
    height: zPositiveLength.optional(),
  }),
  check(project, input, ctx) {
    if (!exists(project.parts, input.id)) return [notFound('part', input.id, Object.keys(project.parts), 'id')];
    if (input.length === undefined && input.width === undefined && input.height === undefined) {
      return [commandError('invalid_input', 'Nothing to change: give "length", "width" or "height".')];
    }
    const part = project.parts[input.id]!;
    if (part.sectionId !== undefined && (input.width !== undefined || input.height !== undefined)) {
      const name = ctx.catalog.sections.get(part.sectionId)?.name ?? part.sectionId;
      return [
        commandError('not_allowed', `${part.id} is a ${name}, so its width and height come from the section.`, {
          path: input.width !== undefined ? 'width' : 'height',
          hint: 'Change its section with update_part instead.',
        }),
      ];
    }
    if (hasCuts(part)) {
      const size = { length: input.length ?? part.size.length, width: input.width ?? part.size.width, height: input.height ?? part.size.height };
      const err = cutsError(size, part.cuts, input.length !== undefined ? 'length' : input.width !== undefined ? 'width' : 'height', `Update or clear ${part.id}'s cuts with update_part ("cuts": null) first.`);
      if (err) return [{ ...err, message: `${part.id}'s cuts don't fit the new size: ${err.message}` }];
    }
    return [];
  },
  apply(project, input) {
    const prev = project.parts[input.id]!;
    const size = {
      length: input.length ?? prev.size.length,
      width: input.width ?? prev.size.width,
      height: input.height ?? prev.size.height,
    };
    const { project: next, inverse } = putWithInverse(project, { parts: [{ ...prev, size }] });
    return {
      project: next,
      inverse,
      redo: { name: 'resize_part', input },
      summary: `Resized ${input.id} to ${formatBoth(size.length)} long.`,
      created: [],
    };
  },
});

export const updatePart = defineCommand({
  name: 'update_part',
  description:
    'Change a part\'s material, section, role, name, build step, tags or assembly. The part keeps its ID even if its role or assembly changes. Changing the section resets width and height to the section\'s size; sectionId null removes the section and keeps the current size.',
  exposed: true,
  schema: z.strictObject({
    id: zId.describe('Part ID, e.g. W2-S07.'),
    materialId: zId.optional().describe('New catalog material ID.'),
    sectionId: zId.nullable().optional().describe('New catalog section ID, or null to remove it.'),
    role: zPartRole.optional(),
    name: z.string().nullable().optional().describe('New name, or null to clear it.'),
    buildStep: zBuildStep.optional(),
    tags: z.array(z.string()).optional().describe('Replaces the tags.'),
    assemblyId: zId.optional().describe('Move the part to another assembly (its ID stays the same).'),
    cuts: zCutsInput.nullable().optional().describe('Replaces the part\'s end cuts and notches, or null to make it a plain box again. ' + zCutsInput.description),
  }),
  check(project, input, ctx) {
    if (!exists(project.parts, input.id)) return [notFound('part', input.id, Object.keys(project.parts), 'id')];
    const { id, ...changes } = input;
    if (Object.values(changes).every((v) => v === undefined)) {
      return [commandError('invalid_input', 'Nothing to change: give at least one field to update.')];
    }
    const part = project.parts[id]!;
    const errors: CommandError[] = [];
    if (input.assemblyId !== undefined && !exists(project.assemblies, input.assemblyId)) {
      errors.push(notFound('assembly', input.assemblyId, Object.keys(project.assemblies), 'assemblyId'));
    }
    const materialId = input.materialId ?? part.materialId;
    const material = ctx.catalog.materials.get(materialId);
    if (!material) {
      errors.push(notFound('material', materialId, ctx.catalog.materials.keys(), 'materialId'));
    }
    const sectionId = input.sectionId === undefined ? part.sectionId : (input.sectionId ?? undefined);
    let size = part.size;
    if (sectionId !== undefined) {
      const section = ctx.catalog.sections.get(sectionId);
      if (!section) errors.push(notFound('section', sectionId, ctx.catalog.sections.keys(), 'sectionId'));
      else {
        if (material) {
          const err = sectionFitsMaterial(section, material, input.sectionId !== undefined ? 'sectionId' : 'materialId');
          if (err) errors.push(err);
        }
        if (input.sectionId) size = { ...size, width: section.dims_mm.width, height: section.dims_mm.depth };
      }
    }
    const cuts = input.cuts === undefined ? part.cuts : (input.cuts ?? undefined);
    if (cuts !== undefined) {
      const err = cutsError(size, cuts, input.cuts !== undefined ? 'cuts' : 'sectionId', input.cuts === undefined ? `Update or clear ${id}'s cuts ("cuts": null) in the same call.` : undefined);
      if (err) errors.push(input.cuts === undefined ? { ...err, message: `${id}'s cuts don't fit the new section: ${err.message}` } : err);
    }
    if (material && input.materialId !== undefined) {
      const bad = incompatibleJoints(project, id, material);
      if (bad.length > 0) {
        errors.push(
          commandError(
            'conflict',
            `${material.name} can't take the joint${bad.length === 1 ? '' : 's'} already on ${id}: ${bad
              .map((j) => `${j.id} (${ctx.catalog.jointTypes.get(j.jointTypeId)?.name ?? j.jointTypeId})`)
              .join(', ')}.`,
            { path: 'materialId', hint: 'Disconnect or change those joints first.' },
          ),
        );
      }
    }
    return errors;
  },
  apply(project, input, ctx) {
    const prev = project.parts[input.id]!;
    const part: Part = { ...prev };
    if (input.materialId !== undefined) part.materialId = input.materialId;
    if (input.role !== undefined) part.role = input.role;
    if (input.buildStep !== undefined) part.buildStep = input.buildStep;
    if (input.tags !== undefined) part.tags = input.tags;
    if (input.name === null) delete part.name;
    else if (input.name !== undefined) part.name = input.name;
    if (input.assemblyId !== undefined) {
      part.assemblyId = input.assemblyId;
      part.levelId = project.assemblies[input.assemblyId]!.levelId;
    }
    if (input.sectionId === null) delete part.sectionId;
    else if (input.sectionId !== undefined) {
      const section = ctx.catalog.sections.get(input.sectionId)!;
      part.sectionId = input.sectionId;
      part.size = { ...part.size, width: section.dims_mm.width, height: section.dims_mm.depth };
    }
    if (input.cuts === null || (input.cuts !== undefined && !hasCuts(input as { cuts: PartCuts }))) delete part.cuts;
    else if (input.cuts !== undefined) part.cuts = input.cuts;
    const { project: next, inverse } = putWithInverse(project, { parts: [part] });
    return {
      project: next,
      inverse,
      redo: { name: 'update_part', input },
      summary: `Updated ${describePart(part, ctx.catalog)}.`,
      created: [],
    };
  },
});

export const deleteParts = defineCommand({
  name: 'delete_parts',
  description: 'Delete parts. Any joints on them are deleted too.',
  exposed: true,
  schema: z.strictObject({
    ids: zIdList('Part IDs to delete, e.g. W2-S07 and W2-S08.'),
  }),
  check(project, input) {
    const missing = input.ids.filter((id) => !exists(project.parts, id));
    if (missing.length === 1) return [notFound('part', missing[0]!, Object.keys(project.parts), 'ids')];
    if (missing.length > 1) {
      return [commandError('not_found', `These parts don't exist: ${quoteList(missing)}.`, { path: 'ids' })];
    }
    return [];
  },
  apply(project, input) {
    const ids = [...new Set(input.ids)];
    const joints = jointsForParts(project, ids).map((j) => j.id);
    const { project: next, inverse } = removeWithInverse(project, { parts: ids, joints });
    const what = ids.length === 1 ? ids[0]! : plural(ids.length, 'part');
    const also = joints.length > 0 ? `; also removed ${plural(joints.length, 'joint')}` : '';
    return { project: next, inverse, redo: { name: 'delete_parts', input }, summary: `Deleted ${what}${also}.`, created: [] };
  },
});

export const partCommands = [addPart, moveParts, resizePart, updatePart, deleteParts];
