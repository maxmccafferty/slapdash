/**
 * The emit layer. Layout functions describe what to build with local keys ("#s3")
 * instead of IDs; `emit` allocates readable IDs in a fixed order (assemblies, then
 * parts in layout order, then joints) and returns plain entities ready to patch in.
 * Because layout is deterministic, `check` and `apply` see the same result.
 */
import type { CatalogIndex } from '../catalog/validate.ts';
import { commandError, notFound, type CommandError } from '../commands/errors.ts';
import type { EntityIds, EntitySnapshots } from '../commands/internal.ts';
import { placeMember, type FrameAxis, type FrameBox, type PlanFrame, type Placed } from '../geometry/frame.ts';
import type { Vec3 } from '../geometry/vec3.ts';
import { GROUND, nextAssemblyId, nextJointId, nextPartId, type AssemblyKind, type IdCounters, type PartRole } from '../model/ids.ts';
import type { Assembly, BuildStep, BuilderRecipe, Joint, Part, PartCuts, Project } from '../model/schema.ts';
import { GROUND_LEVEL_ID } from '../model/create.ts';

/** A key ("#w") for something this layout creates, or the ID of an existing entity. */
export type Ref = string;
export const isKey = (ref: Ref) => ref.startsWith('#');

export type Resolve = (ref: Ref) => string;

export interface AssemblySpec {
  key: Ref;
  kind: AssemblyKind;
  name: string;
  buildStep: BuildStep;
  builder?: (resolve: Resolve) => BuilderRecipe;
}

export interface PartSpec extends Placed {
  key: Ref;
  /** Key of a new assembly, or the ID of an existing one. */
  assembly: Ref;
  role: PartRole;
  materialId: string;
  sectionId?: string;
  name?: string;
  /** `#key` tokens inside tags are replaced by IDs. */
  tags: string[];
  buildStep: BuildStep;
  /** Angled end cuts and notches; the box above stays the part's bound. */
  cuts?: PartCuts;
}

export interface JointSpec {
  /** Part key or existing part ID. */
  a: Ref;
  /** Part key, existing part ID, or "GROUND". */
  b: Ref;
  jointTypeId: string;
  at: Vec3;
  fastenerCount: number;
  note?: string;
}

export interface Layout {
  assemblies: AssemblySpec[];
  parts: PartSpec[];
  joints: JointSpec[];
  /** Existing entities this change removes. */
  remove?: EntityIds;
  /** Existing assemblies to replace (e.g. a recipe update). */
  updateAssemblies?: Assembly[];
  /** Plain-language notes appended to the summary ("Using the default 30 psf snow load."). */
  notes: string[];
  /** One-sentence summary, given the final IDs. */
  summary: (resolve: Resolve) => string;
  /** Extra clash exemptions for this builder. */
  clashSkip?: (candidate: PartSpec, existing: Part) => boolean;
  /** Noun phrase for clash messages, e.g. "The new wall". */
  what: string;
}

export type LayoutResult = { ok: true; layout: Layout } | { ok: false; errors: CommandError[] };

export const fail = (...errors: CommandError[]): LayoutResult => ({ ok: false, errors });

export interface Emitted {
  put: EntitySnapshots;
  remove: EntityIds;
  counters: IdCounters;
  created: string[];
  resolve: Resolve;
}

export function emit(project: Project, layout: Layout): Emitted {
  let counters = project.counters;
  const ids = new Map<string, string>();
  const resolve: Resolve = (ref) => {
    if (!isKey(ref)) return ref;
    const id = ids.get(ref);
    if (id === undefined) throw new Error(`unresolved layout key ${ref}`);
    return id;
  };
  const has = (table: 'assemblies' | 'parts') => (id: string) => Object.hasOwn(project[table], id);

  const created: string[] = [];
  for (const a of layout.assemblies) {
    const next = nextAssemblyId(counters, a.kind, has('assemblies'));
    counters = next.counters;
    ids.set(a.key, next.id);
    created.push(next.id);
  }
  for (const p of layout.parts) {
    const next = nextPartId(counters, resolve(p.assembly), p.role, has('parts'));
    counters = next.counters;
    ids.set(p.key, next.id);
    created.push(next.id);
  }
  const jointIds: string[] = [];
  for (let i = 0; i < layout.joints.length; i++) {
    const next = nextJointId(counters, (id) => Object.hasOwn(project.joints, id));
    counters = next.counters;
    jointIds.push(next.id);
    created.push(next.id);
  }

  const levelOf = (assemblyId: string) => project.assemblies[assemblyId]?.levelId ?? GROUND_LEVEL_ID;
  const resolveTag = (t: string) => t.replace(/#[\w.-]+/g, (m) => ids.get(m) ?? m);

  const assemblies: Assembly[] = layout.assemblies.map((a) => {
    const out: Assembly = { id: resolve(a.key), name: a.name, kind: a.kind, levelId: GROUND_LEVEL_ID, buildStep: a.buildStep };
    if (a.builder) out.builder = a.builder(resolve);
    return out;
  });
  const parts: Part[] = layout.parts.map((p) => {
    const assemblyId = resolve(p.assembly);
    const part: Part = {
      id: resolve(p.key),
      assemblyId,
      levelId: levelOf(assemblyId),
      role: p.role,
      materialId: p.materialId,
      position: p.position,
      rotation: p.rotation,
      size: p.size,
      buildStep: p.buildStep,
      tags: p.tags.map(resolveTag),
    };
    if (p.name !== undefined) part.name = p.name;
    if (p.sectionId !== undefined) part.sectionId = p.sectionId;
    if (p.cuts !== undefined) part.cuts = p.cuts;
    return part;
  });
  const joints: Joint[] = layout.joints.map((j, i) => {
    const joint: Joint = {
      id: jointIds[i]!,
      jointTypeId: j.jointTypeId,
      partIds: [resolve(j.a), j.b === GROUND ? GROUND : resolve(j.b)],
      at: j.at,
      fastenerCount: j.fastenerCount,
    };
    if (j.note !== undefined) joint.note = j.note;
    return joint;
  });

  const put: EntitySnapshots = {};
  const allAssemblies = [...(layout.updateAssemblies ?? []), ...assemblies];
  if (allAssemblies.length > 0) put.assemblies = allAssemblies;
  if (parts.length > 0) put.parts = parts;
  if (joints.length > 0) put.joints = joints;
  return { put, remove: layout.remove ?? {}, counters, created, resolve };
}

/**
 * Every material, section and joint type the layout uses exists, sections suit their
 * materials, and both sides of every joint can take it. Errors name the material so
 * a `materials` override can fix them.
 */
export function checkCatalogRefs(project: Project, layout: Layout, catalog: CatalogIndex): CommandError[] {
  const errors: CommandError[] = [];
  const seen = new Set<string>();
  const push = (e: CommandError) => {
    if (seen.has(e.message)) return;
    seen.add(e.message);
    errors.push(e);
  };
  const specs = new Map(layout.parts.map((p) => [p.key, p]));
  for (const p of layout.parts) {
    const material = catalog.materials.get(p.materialId);
    if (!material) {
      push(notFound('material', p.materialId, catalog.materials.keys(), 'materials'));
      continue;
    }
    if (p.sectionId !== undefined) {
      const section = catalog.sections.get(p.sectionId);
      if (!section) push(notFound('section', p.sectionId, catalog.sections.keys()));
      else if (!section.materialCategories.includes(material.category)) {
        push(
          commandError(
            'invalid_input',
            `A ${section.name} comes in ${section.materialCategories.join(' or ')}, but ${material.name} is ${material.category}.`,
            { path: 'materials' },
          ),
        );
      }
    }
  }
  for (const j of layout.joints) {
    const type = catalog.jointTypes.get(j.jointTypeId);
    if (!type) {
      push(notFound('joint type', j.jointTypeId, catalog.jointTypes.keys()));
      continue;
    }
    for (const ref of [j.a, j.b]) {
      if (ref === GROUND) continue;
      const materialId = isKey(ref) ? specs.get(ref)?.materialId : project.parts[ref]?.materialId;
      if (materialId === undefined) continue;
      const material = catalog.materials.get(materialId);
      if (material && !material.acceptsJoints.includes(type.id)) {
        push(
          commandError('not_allowed', `${material.name} ("${material.id}") can't take ${type.name.toLowerCase()}, which this builder needs.`, {
            path: 'materials',
            hint: 'Pick a material that accepts it, or leave "materials" out to use the defaults.',
          }),
        );
      }
    }
  }
  return errors;
}

/** Collects part specs laid out in one frame, with sequential keys. */
export class SpecList {
  readonly parts: PartSpec[] = [];
  readonly members: Array<{ ref: Ref; role: PartRole; box: FrameBox }> = [];
  #n = 0;
  readonly prefix: string;
  constructor(prefix: string) {
    this.prefix = prefix;
  }

  add(
    frame: PlanFrame,
    m: {
      assembly: Ref;
      role: PartRole;
      tags: string[];
      box: FrameBox;
      lengthAxis: FrameAxis;
      widthAxis: FrameAxis;
      materialId: string;
      sectionId?: string;
      buildStep: BuildStep;
    },
  ): Ref {
    const key = `#${this.prefix}${this.#n++}`;
    const placed = placeMember(frame, m.box, m.lengthAxis, m.widthAxis);
    const spec: PartSpec = { key, assembly: m.assembly, role: m.role, materialId: m.materialId, tags: m.tags, buildStep: m.buildStep, ...placed };
    if (m.sectionId !== undefined) spec.sectionId = m.sectionId;
    this.parts.push(spec);
    this.members.push({ ref: key, role: m.role, box: m.box });
    return key;
  }

  /** Add an already placed part (e.g. a sloped rafter). */
  addPlaced(m: Omit<PartSpec, 'key'>): Ref {
    const key = `#${this.prefix}${this.#n++}`;
    this.parts.push({ ...m, key });
    return key;
  }
}
