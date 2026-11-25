/**
 * place_structure layout: simple boxes for site context (an existing house, a pool,
 * a tree). Context is drawn stippled and is not structural, so it has no joints.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError } from '../../commands/errors.ts';
import type { FrameBox, PlanFrame } from '../../geometry/frame.ts';
import type { Part, Project } from '../../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { BUILDER_DEFAULTS } from '../defaults.ts';
import { SpecList, fail, type LayoutResult } from '../emit.ts';
import { builderSeq, fi, requireMaterial, type PlanPoint } from '../util.ts';

const FT = MM_PER_FOOT;
const IN = MM_PER_INCH;
export const STRUCTURE_BUILDER = 'place_structure';
export const STRUCTURE_KINDS = ['house', 'pool', 'tree', 'shed', 'box'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export interface PlaceStructureInput {
  kind: StructureKind;
  at: PlanPoint;
  width?: number;
  depth?: number;
  height?: number;
  poolDepth?: number;
  canopy?: number;
  rotation?: number;
  name?: string;
}

const DEFAULTS: Record<StructureKind, { width: number; depth: number; height: number }> = {
  house: { width: 40 * FT, depth: 30 * FT, height: 10 * FT },
  shed: { width: 10 * FT, depth: 8 * FT, height: 8 * FT },
  box: { width: 4 * FT, depth: 4 * FT, height: 4 * FT },
  pool: { width: 16 * FT, depth: 32 * FT, height: 0 },
  tree: { width: 0, depth: 0, height: 25 * FT },
};

const TRUNK = 12 * IN;
const NAMES: Record<StructureKind, string> = { house: 'Existing house', pool: 'Pool', tree: 'Tree', shed: 'Existing shed', box: 'Site object' };

export const isSiteContext = (p: { tags: readonly string[] }) => p.tags.includes('site-context');

export function layoutStructure(project: Project, input: PlaceStructureInput, catalog: CatalogIndex): LayoutResult {
  const d = DEFAULTS[input.kind];
  const width = input.width ?? d.width;
  const depth = input.depth ?? d.depth;
  const height = input.height ?? d.height;
  const canopy = input.canopy ?? 15 * FT;
  const poolDepth = input.poolDepth ?? 6 * FT;
  const materialId = BUILDER_DEFAULTS.materials.siteContext;
  const matErr = requireMaterial(catalog, materialId, ['site'], 'kind');
  if (matErr) return fail(matErr);
  if (input.kind === 'tree' && canopy < TRUNK) {
    return fail(commandError('invalid_input', `A tree's canopy (${fi(canopy)}) can't be smaller than its 1' 0" trunk.`, { path: 'canopy' }));
  }

  const frame: PlanFrame = { origin: { x: input.at.x, y: 0, z: input.at.z }, angleDeg: input.rotation ?? 0, wSign: 1 };
  const asm = '#x';
  const step = { phase: 'site' as const, seq: builderSeq(project, STRUCTURE_BUILDER) };
  const specs = new SpecList('x');
  const tags = (extra: string) => ['site-context', 'stippled', `kind:${input.kind}`, extra];
  const add = (box: FrameBox, extra: string) =>
    specs.add(frame, { assembly: asm, role: 'other', tags: tags(extra), box, lengthAxis: 'u', widthAxis: 'w', materialId, buildStep: step });

  let size: string;
  switch (input.kind) {
    case 'house':
    case 'shed':
    case 'box': {
      add({ u0: 0, u1: width, v0: 0, v1: height, w0: 0, w1: depth }, 'body');
      if (input.kind === 'house') {
        // A 6 in 12 gable over the short side, approximated as one box.
        add({ u0: 0, u1: width, v0: height, v1: height + Math.min(width, depth) / 4, w0: 0, w1: depth }, 'roof-volume');
      }
      size = `${fi(width)} × ${fi(depth)}, ${fi(height)} tall`;
      break;
    }
    case 'pool':
      add({ u0: 0, u1: width, v0: -poolDepth, v1: 0, w0: 0, w1: depth }, 'water');
      size = `${fi(width)} × ${fi(depth)}, ${fi(poolDepth)} deep`;
      break;
    case 'tree': {
      const trunkTop = height * 0.4;
      add({ u0: -TRUNK / 2, u1: TRUNK / 2, v0: 0, v1: trunkTop, w0: -TRUNK / 2, w1: TRUNK / 2 }, 'trunk');
      add({ u0: -canopy / 2, u1: canopy / 2, v0: trunkTop, v1: height, w0: -canopy / 2, w1: canopy / 2 }, 'canopy');
      size = `${fi(height)} tall with a ${fi(canopy)} canopy`;
      break;
    }
  }
  const name = input.name ?? NAMES[input.kind];
  return {
    ok: true,
    layout: {
      assemblies: [
        {
          key: asm,
          kind: 'structure',
          name,
          buildStep: step,
          builder: () => ({
            name: STRUCTURE_BUILDER,
            params: { kind: input.kind, at: input.at, width, depth, height, poolDepth, canopy, rotation: input.rotation ?? 0 },
          }),
        },
      ],
      parts: specs.parts,
      joints: [],
      notes: [],
      what: `The ${input.kind}`,
      clashSkip: (_c, existing: Part) => isSiteContext(existing),
      summary: (id) => `Placed ${input.kind} ${id(asm)} "${name}" (site context, not built): ${size}.`,
    },
  };
}
