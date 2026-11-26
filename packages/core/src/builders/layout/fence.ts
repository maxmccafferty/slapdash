/** build_fence layout: posts set in concrete, rails between them, boards on the rails. */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError } from '../../commands/errors.ts';
import { toWorld, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import { GROUND } from '../../model/ids.ts';
import type { Project } from '../../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type JointSpec, type LayoutResult, type Ref } from '../emit.ts';
import { FENCE_MAX_HEIGHT_MM, FENCE_MAX_POST_SPACING_MM } from '../rules.ts';
import { builderSeq, fi, requireMaterial, round6, sectionDims, type PlanPoint } from '../util.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;
export const FENCE_BUILDER = 'build_fence';

export interface BuildFenceInput {
  path: PlanPoint[];
  height?: number;
  style?: 'privacy' | 'picket';
  postSpacing?: number;
  materials?: BuilderMaterialsInput;
  name?: string;
}

export function layoutFence(project: Project, input: BuildFenceInput, catalog: CatalogIndex): LayoutResult {
  const height = input.height ?? 6 * FT;
  const style = input.style ?? 'privacy';
  const spacing = input.postSpacing ?? FENCE_MAX_POST_SPACING_MM;
  const materials = resolveMaterials(input.materials);
  const bad = (msg: string, path: string, hint?: string) => fail(commandError('invalid_input', msg, { path, ...(hint ? { hint } : {}) }));

  if (input.path.length < 2) return bad('A fence needs at least two points in "path".', 'path');
  for (let i = 1; i < input.path.length; i++) {
    const a = input.path[i - 1]!;
    const b = input.path[i]!;
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1) return bad(`path[${i}] repeats the point before it.`, `path[${i}]`);
  }
  if (height > FENCE_MAX_HEIGHT_MM + 1e-6) {
    return bad(`Fences over 8' 0" need engineering and usually a permit (you asked for ${fi(height)}).`, 'height');
  }
  if (height < 3 * FT - 1e-6) return bad(`A fence must be at least 3' 0" tall (you gave ${fi(height)}).`, 'height');
  if (spacing > FENCE_MAX_POST_SPACING_MM + 1e-6) {
    return bad(`Fence posts can be at most 8' 0" apart (you gave ${fi(spacing)}).`, 'postSpacing');
  }
  if (spacing < 2 * FT - 1e-6) return bad(`Fence posts must be at least 2' 0" apart (you gave ${fi(spacing)}).`, 'postSpacing');
  for (const e of [
    requireMaterial(catalog, materials.treatedLumber, ['lumber'], 'materials.treatedLumber'),
    requireMaterial(catalog, materials.lumber, ['lumber'], 'materials.lumber'),
    requireMaterial(catalog, materials.concrete, ['concrete'], 'materials.concrete'),
  ]) {
    if (e) return fail(e);
  }

  const S = BUILDER_DEFAULTS.sections;
  const post = sectionDims(catalog, S.fencePost);
  const rail = sectionDims(catalog, S.fenceRail);
  const boardSec = style === 'privacy' ? S.privacyBoard : S.picketBoard;
  const board = sectionDims(catalog, boardSec);
  const hp = post.width / 2;
  const below = Math.max(2 * FT, height / 2);
  const pierHalf = 6 * IN;
  const asm = '#m';
  const step = { phase: 'site' as const, seq: builderSeq(project, FENCE_BUILDER) };
  const specs = new SpecList('f');
  const joints: JointSpec[] = [];
  const J = BUILDER_DEFAULTS.jointTypes;

  const railCount = height > 5 * FT ? 3 : 2;
  const railBottoms: number[] = [6 * IN, height - 6 * IN - rail.depth];
  if (railCount === 3) railBottoms.splice(1, 0, (railBottoms[0]! + railBottoms[1]!) / 2);

  let postCount = 0;
  let boardCount = 0;
  let prevEndPost: Ref | null = null;
  const worldAt = (f: PlanFrame, p: { u: number; v: number; w: number }) => {
    const w = toWorld(f, p);
    return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
  };

  for (let s = 0; s + 1 < input.path.length; s++) {
    const a = input.path[s]!;
    const b = input.path[s + 1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const frame: PlanFrame = { origin: { x: a.x, y: 0, z: a.z }, angleDeg: (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI, wSign: 1 };
    const bays = Math.max(1, Math.ceil(L / spacing - 1e-9));
    const posts: Ref[] = [];
    for (let k = 0; k <= bays; k++) {
      if (k === 0 && prevEndPost) {
        posts.push(prevEndPost);
        continue;
      }
      const c = (k * L) / bays;
      const key = specs.add(frame, {
        assembly: asm,
        role: 'post',
        tags: ['fence-post'],
        box: { u0: c - hp, u1: c + hp, v0: -below, v1: height, w0: -hp, w1: hp },
        lengthAxis: 'v',
        widthAxis: 'u',
        materialId: materials.treatedLumber,
        sectionId: S.fencePost,
        buildStep: step,
      });
      const pier = specs.add(frame, {
        assembly: asm,
        role: 'pier',
        tags: ['post-footing'],
        box: { u0: c - pierHalf, u1: c + pierHalf, v0: -below - 6 * IN, v1: 0, w0: -pierHalf, w1: pierHalf },
        lengthAxis: 'v',
        widthAxis: 'u',
        materialId: materials.concrete,
        buildStep: step,
      });
      joints.push({ a: key, b: pier, jointTypeId: J.postEmbedded, at: worldAt(frame, { u: c, v: -below, w: 0 }), fastenerCount: 1 });
      joints.push({ a: pier, b: GROUND, jointTypeId: J.castInPlace, at: worldAt(frame, { u: c, v: -below - 6 * IN, w: 0 }), fastenerCount: 1 });
      posts.push(key);
      postCount++;
    }
    prevEndPost = posts[posts.length - 1]!;

    // Rails, flush with the +w face of the posts.
    const railsByBay: Array<{ u0: number; u1: number; refs: Ref[] }> = [];
    for (let k = 0; k < bays; k++) {
      const c0 = (k * L) / bays;
      const c1 = ((k + 1) * L) / bays;
      const refs: Ref[] = [];
      for (const v0 of railBottoms) {
        const box: FrameBox = { u0: c0 + hp, u1: c1 - hp, v0, v1: v0 + rail.depth, w0: hp - rail.width, w1: hp };
        const key = specs.add(frame, {
          assembly: asm,
          role: 'rail',
          tags: ['fence-rail'],
          box,
          lengthAxis: 'u',
          widthAxis: 'w',
          materialId: materials.lumber,
          sectionId: S.fenceRail,
          buildStep: step,
        });
        refs.push(key);
        const vc = v0 + rail.depth / 2;
        joints.push({ a: key, b: posts[k]!, jointTypeId: J.nail16d, at: worldAt(frame, { u: c0 + hp, v: vc, w: hp - rail.width / 2 }), fastenerCount: 2 });
        joints.push({ a: key, b: posts[k + 1]!, jointTypeId: J.nail16d, at: worldAt(frame, { u: c1 - hp, v: vc, w: hp - rail.width / 2 }), fastenerCount: 2 });
      }
      railsByBay.push({ u0: c0, u1: c1, refs });
    }

    // Boards on the outside of the rails.
    const gap = style === 'privacy' ? 0 : 3.5 * IN;
    const n = Math.max(1, Math.floor((L + gap) / (board.depth + gap) + 1e-9));
    const pitch = L / n;
    for (let i = 0; i < n; i++) {
      const u0 = i * pitch + (pitch - board.depth) / 2;
      const key = specs.add(frame, {
        assembly: asm,
        role: 'panel',
        tags: ['fence-board', style],
        box: { u0, u1: u0 + board.depth, v0: 2 * IN, v1: height, w0: hp, w1: hp + board.width },
        lengthAxis: 'v',
        widthAxis: 'w',
        materialId: materials.lumber,
        sectionId: boardSec,
        buildStep: step,
      });
      boardCount++;
      const uc = u0 + board.depth / 2;
      const bay = railsByBay.find((r) => uc >= r.u0 && uc <= r.u1) ?? railsByBay[railsByBay.length - 1]!;
      bay.refs.forEach((r, k) => {
        joints.push({
          a: key,
          b: r,
          jointTypeId: J.nail8d,
          at: worldAt(frame, { u: uc, v: railBottoms[k]! + rail.depth / 2, w: hp }),
          fastenerCount: 2,
        });
      });
    }
  }

  const total = input.path.slice(1).reduce((acc, p, i) => acc + Math.hypot(p.x - input.path[i]!.x, p.z - input.path[i]!.z), 0);
  const name = input.name ?? 'Fence';
  return {
    ok: true,
    layout: {
      assemblies: [
        {
          key: asm,
          kind: 'misc',
          name,
          buildStep: step,
          builder: () => ({ name: FENCE_BUILDER, params: { path: input.path, height, style, postSpacing: spacing, materials } }),
        },
      ],
      parts: specs.parts,
      joints,
      notes: [],
      what: 'The new fence',
      summary: (id) =>
        `Built fence ${id(asm)} "${name}": ${fi(total)} of ${fi(height)} ${style} fence, ${postCount} posts set ${fi(below)} deep in concrete, ${railCount} rails per bay, ${boardCount} boards.`,
    },
  };
}
