import { z } from 'zod';
import type { CatalogIndex } from '../catalog/validate.ts';
import { GROUND, JOINT_ID, nextJointId, reserveId } from '../model/ids.ts';
import type { CapacityOverride, Joint, Project } from '../model/schema.ts';
import { zVec3Input } from '../units/zod.ts';
import { commandError, notFound, type CommandError } from './errors.ts';
import { checkExplicitId, exists, quoteList, zId, zIdList } from './common.ts';
import { putWithInverse, removeWithInverse } from './internal.ts';
import { defineCommand } from './types.ts';

const zCapacityOverrideInput = z
  .strictObject({
    shear_N: z.number().nonnegative().optional().describe('Shear capacity in newtons.'),
    withdrawal_N: z.number().nonnegative().optional().describe('Withdrawal capacity in newtons.'),
    uplift_N: z.number().nonnegative().optional().describe('Uplift capacity in newtons.'),
  })
  .describe('Replace the catalog rating for this one joint (e.g. from a manufacturer sheet). Newtons, whole joint.');

const zFastenerCount = z.number().int().min(1).describe('Number of fasteners. Defaults to the joint type\'s usual count.');

export interface JointFields {
  jointTypeId: string;
  partIds: readonly [string, string];
  /** Joint being edited, excluded from the duplicate check. */
  selfId?: string;
}

/** Semantic checks shared by connect and update_joint. */
export function checkJoint(project: Project, j: JointFields, catalog: CatalogIndex): CommandError[] {
  const errors: CommandError[] = [];
  const type = catalog.jointTypes.get(j.jointTypeId);
  if (!type) errors.push(notFound('joint type', j.jointTypeId, catalog.jointTypes.keys(), 'jointTypeId'));

  const [a, b] = j.partIds;
  if (a === GROUND) {
    errors.push(
      commandError('invalid_input', `"GROUND" can only be the second part of a joint.`, {
        path: 'partIds[0]',
        hint: `Write ["<part>", "GROUND"].`,
      }),
    );
    return errors;
  }
  if (a === b) {
    errors.push(commandError('invalid_input', `A joint needs two different parts; both are "${a}".`, { path: 'partIds' }));
    return errors;
  }
  const missing = [a, b].filter((id) => id !== GROUND && !exists(project.parts, id));
  if (missing.length === 1) {
    const idx = missing[0] === a ? 0 : 1;
    errors.push(notFound('part', missing[0]!, Object.keys(project.parts), `partIds[${idx}]`));
  } else if (missing.length > 1) {
    errors.push(commandError('not_found', `These parts don't exist: ${quoteList(missing)}.`, { path: 'partIds' }));
  }
  if (!type || missing.length > 0) return errors;

  for (const id of [a, b]) {
    if (id === GROUND) continue;
    const part = project.parts[id]!;
    const material = catalog.materials.get(part.materialId);
    if (material && !material.acceptsJoints.includes(type.id)) {
      const accepted = material.acceptsJoints
        .map((t) => catalog.jointTypes.get(t)?.name ?? t)
        .join(', ');
      errors.push(
        commandError('not_allowed', `${material.name} (${id}) can't take a ${type.name.toLowerCase()} joint.`, {
          path: 'jointTypeId',
          hint: accepted ? `It accepts: ${accepted}.` : undefined,
        }),
      );
    }
  }

  const pair = new Set([a, b]);
  const dup = Object.values(project.joints).find(
    (x) =>
      x.id !== j.selfId &&
      x.jointTypeId === j.jointTypeId &&
      pair.has(x.partIds[0]) &&
      pair.has(x.partIds[1]),
  );
  if (dup) {
    errors.push(
      commandError('conflict', `${a} and ${b} are already joined by ${dup.id} (${type.name}).`, {
        hint: `Change its fastener count with update_joint instead.`,
      }),
    );
  }
  return errors;
}

export const connect = defineCommand({
  name: 'connect',
  description:
    'Join two parts with a joint type from the catalog (nails, a hanger, a post base…). Use "GROUND" as the second part for a support on the ground. Both parts\' materials must accept the joint type.',
  exposed: true,
  schema: z.strictObject({
    jointTypeId: zId('Catalog joint type ID, e.g. "nailed-16d".'),
    partIds: z
      .tuple([z.string().min(1), z.string().min(1)])
      .describe('The two part IDs, e.g. ["W2-S07", "W2-P01"]. The second may be "GROUND".'),
    at: zVec3Input.describe('Where the joint is.'),
    fastenerCount: zFastenerCount.optional(),
    capacityOverride: zCapacityOverrideInput.optional(),
    note: z.string().optional(),
    id: z.string().optional().describe('Explicit ID like "J0012". Usually left out so one is chosen.'),
  }),
  check(project, input, ctx) {
    const errors = checkJoint(project, input, ctx.catalog);
    if (input.id !== undefined) {
      const err = checkExplicitId(project, 'joints', input.id, JOINT_ID, '"J0012"');
      if (err) errors.push(err);
    }
    return errors;
  },
  apply(project, input, ctx) {
    const type = ctx.catalog.jointTypes.get(input.jointTypeId)!;
    let counters = project.counters;
    let id = input.id;
    if (id === undefined) ({ id, counters } = nextJointId(counters, (x) => exists(project.joints, x)));
    else counters = reserveId(counters, 'joint', id);
    const joint: Joint = {
      id,
      jointTypeId: input.jointTypeId,
      partIds: [input.partIds[0], input.partIds[1]],
      at: { ...input.at },
      fastenerCount: input.fastenerCount ?? type.defaultFastenerCount,
    };
    if (input.capacityOverride) joint.capacityOverride = input.capacityOverride;
    if (input.note !== undefined) joint.note = input.note;
    const { project: next, inverse } = putWithInverse({ ...project, counters }, { joints: [joint] });
    return {
      project: next,
      inverse,
      redo: { name: 'connect', input: { ...input, id, fastenerCount: joint.fastenerCount } },
      summary: `Joined ${joint.partIds[0]} to ${joint.partIds[1]} with ${type.name} (${id}).`,
      created: [id],
    };
  },
});

export const updateJoint = defineCommand({
  name: 'update_joint',
  description:
    'Change a joint\'s type, fastener count, capacity override, location or note. capacityOverride or note null clears it.',
  exposed: true,
  schema: z.strictObject({
    id: zId('Joint ID, e.g. "J0012".'),
    jointTypeId: z.string().optional(),
    fastenerCount: zFastenerCount.optional(),
    capacityOverride: zCapacityOverrideInput.nullable().optional(),
    at: zVec3Input.optional(),
    note: z.string().nullable().optional(),
  }),
  check(project, input, ctx) {
    if (!exists(project.joints, input.id)) return [notFound('joint', input.id, Object.keys(project.joints), 'id')];
    const { id, ...changes } = input;
    if (Object.values(changes).every((v) => v === undefined)) {
      return [commandError('invalid_input', 'Nothing to change: give at least one field to update.')];
    }
    const joint = project.joints[id]!;
    if (input.jointTypeId === undefined) return [];
    return checkJoint(project, { jointTypeId: input.jointTypeId, partIds: joint.partIds, selfId: id }, ctx.catalog);
  },
  apply(project, input, ctx) {
    const prev = project.joints[input.id]!;
    const joint: Joint = { ...prev };
    if (input.jointTypeId !== undefined) joint.jointTypeId = input.jointTypeId;
    if (input.fastenerCount !== undefined) joint.fastenerCount = input.fastenerCount;
    if (input.at !== undefined) joint.at = { ...input.at };
    if (input.capacityOverride === null) delete joint.capacityOverride;
    else if (input.capacityOverride !== undefined) joint.capacityOverride = input.capacityOverride as CapacityOverride;
    if (input.note === null) delete joint.note;
    else if (input.note !== undefined) joint.note = input.note;
    const { project: next, inverse } = putWithInverse(project, { joints: [joint] });
    const typeName = ctx.catalog.jointTypes.get(joint.jointTypeId)?.name ?? joint.jointTypeId;
    return {
      project: next,
      inverse,
      redo: { name: 'update_joint', input },
      summary: `Updated ${joint.id} (${typeName}, ${joint.fastenerCount} fastener${joint.fastenerCount === 1 ? '' : 's'}).`,
      created: [],
    };
  },
});

export const disconnect = defineCommand({
  name: 'disconnect',
  description: 'Remove joints by ID. The parts stay.',
  exposed: true,
  schema: z.strictObject({
    ids: zIdList('Joint IDs, e.g. ["J0012"].'),
  }),
  check(project, input) {
    const missing = input.ids.filter((id) => !exists(project.joints, id));
    if (missing.length === 1) return [notFound('joint', missing[0]!, Object.keys(project.joints), 'ids')];
    if (missing.length > 1) {
      return [commandError('not_found', `These joints don't exist: ${quoteList(missing)}.`, { path: 'ids' })];
    }
    return [];
  },
  apply(project, input) {
    const ids = [...new Set(input.ids)];
    const { project: next, inverse } = removeWithInverse(project, { joints: ids });
    return {
      project: next,
      inverse,
      redo: { name: 'disconnect', input },
      summary: `Removed ${ids.length === 1 ? `joint ${ids[0]}` : `${ids.length} joints`}.`,
      created: [],
    };
  },
});

export const jointCommands = [connect, updateJoint, disconnect];
