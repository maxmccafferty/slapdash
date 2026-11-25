/**
 * Project builders for the solver tests: the pool-house shell (the same commands as
 * `apps/web/src/model/sample-shell.ts`), builder-made walls, and tiny hand-made models.
 */
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, formatErrors, indexCatalog, type Assembly, type Joint, type Part, type Project } from '@slapdash/core';

export const CATALOG = TIER1_CATALOG;
export const INDEX = indexCatalog(TIER1_CATALOG);

/** Mirrors SAMPLE_SHELL_COMMANDS in apps/web/src/model/sample-shell.ts. */
export const POOL_HOUSE_COMMANDS: ReadonlyArray<readonly [string, unknown]> = [
  ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }],
  ['build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }],
  ['build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' }],
  ['build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' }],
  ['build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' }],
  ['add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' }],
  ['add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' }],
  ['build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' }],
];

export function build(commands: ReadonlyArray<readonly [string, unknown]>, name = 'Test'): Project {
  const bus = new CommandBus({ project: createProject({ name }), catalog: TIER1_CATALOG });
  for (const [cmd, input] of commands) {
    const res = bus.execute(cmd, input);
    if (!res.ok) throw new Error(`${cmd}: ${formatErrors(res.errors)}`);
  }
  return bus.project;
}

let poolHouseCache: Project | undefined;
export function poolHouse(): Project {
  return (poolHouseCache ??= build(POOL_HOUSE_COMMANDS, 'Pool house'));
}

/** A slab and four walls (a box) with the given bracing; small enough to stand without a roof. */
export function wallBox(bracing: 'sheathing' | 'let-in' | 'none', size: { x: string; z: string } = { x: '12ft', z: '12ft' }): Project {
  return build([
    ['pour_slab', { from: { x: 0, z: 0 }, to: size }],
    ['build_wall', { start: { x: 0, z: 0 }, end: { x: size.x, z: 0 }, height: '8ft', bracing }],
    ['build_wall', { start: { x: size.x, z: 0 }, end: size, height: '8ft', bracing }],
    ['build_wall', { start: size, end: { x: 0, z: size.z }, height: '8ft', bracing }],
    ['build_wall', { start: { x: 0, z: size.z }, end: { x: 0, z: 0 }, height: '8ft', bracing }],
  ]);
}

export interface HandPart {
  id: string;
  role: Part['role'];
  materialId: string;
  sectionId?: string;
  assemblyId?: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  size: { length: number; width: number; height: number };
  tags?: string[];
}

export interface HandJoint {
  id: string;
  jointTypeId: string;
  partIds: [string, string];
  at: { x: number; y: number; z: number };
  fastenerCount?: number;
  capacityOverride?: Joint['capacityOverride'];
}

/** A project made by hand, bypassing the builders (for small analytical cases). */
export function handProject(
  parts: HandPart[],
  joints: HandJoint[],
  assemblies: Record<string, { kind: Assembly['kind']; params?: Record<string, unknown> }> = { X1: { kind: 'structure' } },
): Project {
  const p = createProject({ name: 'Hand' });
  for (const [id, a] of Object.entries(assemblies)) {
    p.assemblies[id] = { id, name: id, kind: a.kind, levelId: 'L0', ...(a.params ? { builder: { name: 'hand', params: a.params } } : {}) };
  }
  const first = Object.keys(assemblies)[0]!;
  for (const x of parts) {
    p.parts[x.id] = {
      id: x.id,
      assemblyId: x.assemblyId ?? first,
      levelId: 'L0',
      role: x.role,
      materialId: x.materialId,
      ...(x.sectionId ? { sectionId: x.sectionId } : {}),
      position: x.position,
      rotation: x.rotation ?? { x: 0, y: 0, z: 0 },
      size: x.size,
      buildStep: { phase: 'framing' },
      tags: x.tags ?? [],
    };
  }
  for (const j of joints) {
    p.joints[j.id] = {
      id: j.id,
      jointTypeId: j.jointTypeId,
      partIds: j.partIds,
      at: j.at,
      fastenerCount: j.fastenerCount ?? CATALOG.jointTypes.find((t) => t.id === j.jointTypeId)!.defaultFastenerCount,
      ...(j.capacityOverride ? { capacityOverride: j.capacityOverride } : {}),
    };
  }
  return p;
}

const IN = 25.4;
/** Actual section sizes (width × depth), mm. */
export const SECTION = { '2x4': [38.1, 88.9], '2x6': [38.1, 139.7], '2x8': [38.1, 184.15], '2x10': [38.1, 234.95], '2x12': [38.1, 285.75] } as const;
export { IN };

/**
 * A horizontal member along +x on edge (depth vertical), from x = 0 to `length`, its
 * underside at y = 0, with joints to GROUND at both ends.
 */
export function beamOnSupports(opts: {
  length: number;
  section: keyof typeof SECTION;
  materialId?: string;
  role?: Part['role'];
  jointTypeId?: string;
  assembly?: { kind: Assembly['kind']; params?: Record<string, unknown> };
  tags?: string[];
}): Project {
  const [b, h] = SECTION[opts.section];
  // rotation x = 90°: local y (width) → world z, local z (depth) → world −y; so start one depth up.
  return handProject(
    [
      {
        id: 'B1-J01',
        role: opts.role ?? 'joist',
        materialId: opts.materialId ?? 'spf-no2',
        sectionId: opts.section,
        assemblyId: 'B1',
        position: { x: 0, y: h, z: 0 },
        rotation: { x: 90, y: 0, z: 0 },
        size: { length: opts.length, width: b, height: h },
        tags: opts.tags ?? [],
      },
    ],
    [
      { id: 'J0001', jointTypeId: opts.jointTypeId ?? 'nailed-16d', partIds: ['B1-J01', 'GROUND'], at: { x: 0, y: h / 2, z: b / 2 } },
      { id: 'J0002', jointTypeId: opts.jointTypeId ?? 'nailed-16d', partIds: ['B1-J01', 'GROUND'], at: { x: opts.length, y: h / 2, z: b / 2 } },
    ],
    { B1: opts.assembly ?? { kind: 'structure' } },
  );
}
