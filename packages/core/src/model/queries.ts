/** Small, pure read helpers over a project. */
import type { CatalogIndex } from '../catalog/validate.ts';
import type { JointBehaviour } from '../catalog/schema.ts';
import type { Assembly, Joint, Part, Project } from './schema.ts';

export function getPart(project: Project, id: string): Part | undefined {
  return Object.hasOwn(project.parts, id) ? project.parts[id] : undefined;
}

export function getAssembly(project: Project, id: string): Assembly | undefined {
  return Object.hasOwn(project.assemblies, id) ? project.assemblies[id] : undefined;
}

export function getJoint(project: Project, id: string): Joint | undefined {
  return Object.hasOwn(project.joints, id) ? project.joints[id] : undefined;
}

export function partsInAssembly(project: Project, assemblyId: string): Part[] {
  return Object.values(project.parts).filter((p) => p.assemblyId === assemblyId);
}

export function jointsForPart(project: Project, partId: string): Joint[] {
  return Object.values(project.joints).filter((j) => j.partIds[0] === partId || j.partIds[1] === partId);
}

/** Joints touching any of the given parts. */
export function jointsForParts(project: Project, partIds: Iterable<string>): Joint[] {
  const ids = new Set(partIds);
  return Object.values(project.joints).filter((j) => ids.has(j.partIds[0]) || ids.has(j.partIds[1]));
}

/** Pinned or fixed, from the joint's type in the catalog (ADR-0002 §E5). */
export function jointBehaviour(joint: Joint, catalog: CatalogIndex): JointBehaviour | undefined {
  return catalog.jointTypes.get(joint.jointTypeId)?.behaviour;
}

export interface ResolvedCapacity {
  shear_N: number;
  withdrawal_N?: number;
  uplift_N?: number;
}

/**
 * The joint's rating: the catalog capacity, multiplied by the fastener count when
 * the catalog gives it per fastener. Any value in `capacityOverride` wins.
 */
export function jointCapacity(joint: Joint, catalog: CatalogIndex): ResolvedCapacity | undefined {
  const type = catalog.jointTypes.get(joint.jointTypeId);
  if (!type) return undefined;
  const k = type.capacity.basis === 'per-fastener' ? joint.fastenerCount : 1;
  const out: ResolvedCapacity = { shear_N: type.capacity.shear_N * k };
  if (type.capacity.withdrawal_N !== undefined) out.withdrawal_N = type.capacity.withdrawal_N * k;
  if (type.capacity.uplift_N !== undefined) out.uplift_N = type.capacity.uplift_N * k;
  const o = joint.capacityOverride;
  if (o) {
    if (o.shear_N !== undefined) out.shear_N = o.shear_N;
    if (o.withdrawal_N !== undefined) out.withdrawal_N = o.withdrawal_N;
    if (o.uplift_N !== undefined) out.uplift_N = o.uplift_N;
  }
  return out;
}
