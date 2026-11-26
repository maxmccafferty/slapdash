/** pour_slab layout: a slab on grade with optional thickened-edge footings. */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError } from '../../commands/errors.ts';
import { WORLD_FRAME, toWorld, type FrameBox } from '../../geometry/frame.ts';
import { GROUND } from '../../model/ids.ts';
import type { Project } from '../../model/schema.ts';
import { MM_PER_INCH } from '../../units/length.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type JointSpec, type LayoutResult } from '../emit.ts';
import type { SiteDefaults } from '../../site/design-loads.ts';
import { builderSeq, fi, footingDepth, requireMaterial, round6, type PlanPoint } from '../util.ts';

const IN = MM_PER_INCH;
export const SLAB_BUILDER = 'pour_slab';
const EDGE_WIDTH = 12 * IN;

export interface PourSlabInput {
  from: PlanPoint;
  to: PlanPoint;
  thickness?: number;
  top?: number;
  thickenedEdge?: boolean;
  materials?: BuilderMaterialsInput;
  name?: string;
}

const center = (b: FrameBox) => ({ u: (b.u0 + b.u1) / 2, v: (b.v0 + b.v1) / 2, w: (b.w0 + b.w1) / 2 });
const at = (p: { u: number; v: number; w: number }) => {
  const w = toWorld(WORLD_FRAME, p);
  return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
};

export function layoutSlab(project: Project, input: PourSlabInput, catalog: CatalogIndex, siteDefaults?: SiteDefaults): LayoutResult {
  const x0 = Math.min(input.from.x, input.to.x);
  const x1 = Math.max(input.from.x, input.to.x);
  const z0 = Math.min(input.from.z, input.to.z);
  const z1 = Math.max(input.from.z, input.to.z);
  const thickness = input.thickness ?? 4 * IN;
  const top = input.top ?? 4 * IN;
  const thick = input.thickenedEdge ?? true;
  const materials = resolveMaterials(input.materials);

  if (x1 - x0 < 1 || z1 - z0 < 1) {
    return fail(commandError('invalid_input', 'A slab needs both a length and a width; "from" and "to" are on the same line.', { path: 'to' }));
  }
  const maxSide = BUILDER_DEFAULTS.maxSlabSide;
  if (x1 - x0 > maxSide || z1 - z0 > maxSide) {
    return fail(
      commandError('invalid_input', `A slab side of ${fi(Math.max(x1 - x0, z1 - z0))} is longer than ${fi(maxSide)}; pour it as separate slabs with joints.`, {
        path: 'to',
      }),
    );
  }
  if (thickness < 3.5 * IN - 1e-6) {
    return fail(commandError('invalid_input', `A structural slab is at least 3 1/2" thick (you gave ${fi(thickness)}).`, { path: 'thickness' }));
  }
  if (thick && (x1 - x0 < 2 * EDGE_WIDTH + IN || z1 - z0 < 2 * EDGE_WIDTH + IN)) {
    return fail(
      commandError('invalid_input', `A slab under ${fi(2 * EDGE_WIDTH + IN)} wide is too small for 12" thickened edges.`, {
        path: 'thickenedEdge',
        hint: 'Set thickenedEdge: false.',
      }),
    );
  }
  const matErr = requireMaterial(catalog, materials.concrete, ['concrete'], 'materials.concrete');
  if (matErr) return fail(matErr);

  const fd = footingDepth(project, siteDefaults);
  const bottom = top - thickness;
  if (thick && bottom <= -fd.mm + 1) {
    return fail(commandError('invalid_input', `The slab's underside (${fi(bottom)}) is already below the footing depth (${fi(-fd.mm)}).`, { path: 'top' }));
  }

  const asm = '#fd';
  const seq = builderSeq(project, SLAB_BUILDER);
  const step = { phase: 'foundation' as const, seq };
  const specs = new SpecList('p');
  const slabBox: FrameBox = { u0: x0, u1: x1, v0: bottom, v1: top, w0: z0, w1: z1 };
  const slab = specs.add(WORLD_FRAME, {
    assembly: asm,
    role: 'slab',
    tags: ['slab'],
    box: slabBox,
    lengthAxis: 'u',
    widthAxis: 'w',
    materialId: materials.concrete,
    buildStep: step,
  });
  const joints: JointSpec[] = [];
  const cip = BUILDER_DEFAULTS.jointTypes.castInPlace;
  if (thick) {
    const v0 = -fd.mm;
    const edges: Array<[string, FrameBox, 'u' | 'w']> = [
      ['north', { u0: x0, u1: x1, v0, v1: bottom, w0: z0, w1: z0 + EDGE_WIDTH }, 'u'],
      ['south', { u0: x0, u1: x1, v0, v1: bottom, w0: z1 - EDGE_WIDTH, w1: z1 }, 'u'],
      ['west', { u0: x0, u1: x0 + EDGE_WIDTH, v0, v1: bottom, w0: z0 + EDGE_WIDTH, w1: z1 - EDGE_WIDTH }, 'w'],
      ['east', { u0: x1 - EDGE_WIDTH, u1: x1, v0, v1: bottom, w0: z0 + EDGE_WIDTH, w1: z1 - EDGE_WIDTH }, 'w'],
    ];
    for (const [side, box, along] of edges) {
      const key = specs.add(WORLD_FRAME, {
        assembly: asm,
        role: 'footing',
        tags: ['thickened-edge', side],
        box,
        lengthAxis: along,
        widthAxis: along === 'u' ? 'w' : 'u',
        materialId: materials.concrete,
        buildStep: step,
      });
      const c = center(box);
      joints.push({ a: slab, b: key, jointTypeId: cip, at: at({ ...c, v: bottom }), fastenerCount: 1 });
      joints.push({ a: key, b: GROUND, jointTypeId: cip, at: at({ ...c, v: v0 }), fastenerCount: 1 });
    }
  } else {
    joints.push({ a: slab, b: GROUND, jointTypeId: cip, at: at({ ...center(slabBox), v: bottom }), fastenerCount: 1 });
  }

  const name = input.name ?? 'Slab';
  const notes = thick ? [`Thickened edges go ${fi(fd.mm)} below grade (${fd.note}).`] : [];
  return {
    ok: true,
    layout: {
      assemblies: [
        {
          key: asm,
          kind: 'foundation',
          name,
          buildStep: step,
          builder: () => ({
            name: SLAB_BUILDER,
            params: { from: { x: x0, z: z0 }, to: { x: x1, z: z1 }, thickness, top, thickenedEdge: thick, footingDepth: fd.mm, materials },
          }),
        },
      ],
      parts: specs.parts,
      joints,
      notes,
      what: 'The new slab',
      summary: (id) =>
        `Poured slab ${id(asm)} "${name}": ${fi(x1 - x0)} × ${fi(z1 - z0)}, ${fi(thickness)} thick, top at ${fi(top)}${thick ? ', with thickened edges' : ''}.`,
    },
  };
}
