/**
 * build_pergola layout: a freestanding post-and-beam pergola.
 *
 * Plan frame: u runs along the beams, w across them (the rafter direction), with the low
 * row of posts at w = 0. Posts stand on post bases on concrete piers. Two rows of doubled
 * beams sandwich the post tops; the low row's posts are shorter by slope × run so the
 * beams set the slope. Rafters cross the beams at the slope, with a hurricane tie at each
 * crossing. With roofing, flat 2x4 purlins run across the rafters and roofing panels lie
 * on the purlins, screwed to each one.
 *
 * Assemblies: "Pergola" (kind misc: posts, piers, beams, and the rafters when it's open)
 * and, with roofing, "Pergola roof" (kind roof: rafters, purlins and panels), so the
 * solver puts snow and wind on the panels and an open pergola gets no roof snow load.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { placeOriented, toWorld, type FrameVec, type PlanFrame } from '../../geometry/frame.ts';
import { GROUND } from '../../model/ids.ts';
import type { Project } from '../../model/schema.ts';
import type { SiteDefaults } from '../../site/design-loads.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { formatPitch, pitchFromRatio, type Pitch } from '../../units/pitch.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type JointSpec, type LayoutResult, type Ref } from '../emit.ts';
import {
  METAL_PANEL_COVER_MM,
  PERGOLA_BEAM_MAX_SPAN_MM,
  POLYCARBONATE_COVER_MM,
  POLYCARBONATE_MAX_PURLIN_MM,
  POLYCARBONATE_MIN_SLOPE,
  SPACING_MM,
  STOCK_LENGTH_MM,
} from '../rules.ts';
import { builderSeq, fi, footingDepth, requireMaterial, requireSection, round6, sectionDims, snowLoad, type PlanPoint } from '../util.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;
const T = BUILDER_DEFAULTS.twoBy;
export const PERGOLA_BUILDER = 'build_pergola';
const PIER_HALF = 6 * IN;
/** Modelled thickness of a corrugated roofing panel (its weight comes from the catalog's areal mass). */
const PANEL_THICKNESS = 0.5 * IN;

export interface BuildPergolaInput {
  from: PlanPoint;
  to: PlanPoint;
  height?: number;
  postSize?: '4x4' | '6x6';
  beamSize?: '2x8' | '2x10' | '2x12';
  beamAxis?: 'x' | 'z';
  rafterSize?: '2x6' | '2x8';
  rafterSpacing?: '12in' | '16in' | '24in';
  overhang?: number;
  roofing?: string;
  slope?: Pitch;
  lowSide?: 'north' | 'south' | 'east' | 'west';
  materials?: BuilderMaterialsInput;
  name?: string;
}

export function layoutPergola(project: Project, input: BuildPergolaInput, catalog: CatalogIndex, siteDefaults?: SiteDefaults): LayoutResult {
  const bad = (msg: string, path: string, hint?: string): LayoutResult => fail(commandError('invalid_input', msg, { path, ...(hint ? { hint } : {}) }));
  const D = BUILDER_DEFAULTS.materials;
  const x0 = Math.min(input.from.x, input.to.x);
  const x1 = Math.max(input.from.x, input.to.x);
  const z0 = Math.min(input.from.z, input.to.z);
  const z1 = Math.max(input.from.z, input.to.z);
  if (x1 - x0 < 6 * FT || z1 - z0 < 6 * FT) return bad('A pergola must be at least 6\' 0" on each side.', 'to');
  const height = input.height ?? 8 * FT;
  const postSize = input.postSize ?? '6x6';
  const beamSize = input.beamSize ?? '2x8';
  const rafterSize = input.rafterSize ?? '2x6';
  const overhang = input.overhang ?? 12 * IN;
  const roofingIn = input.roofing ?? 'none';
  const roofingId = roofingIn === 'none' ? null : roofingIn === 'polycarbonate' ? D.polycarbonate : roofingIn === 'metal' ? D.metalRoofing : roofingIn;
  const roofed = roofingId !== null;
  const spacingLabel = input.rafterSpacing ?? (roofed ? '24in' : '16in');
  const spacing = SPACING_MM[spacingLabel];
  const slope = input.slope ?? pitchFromRatio(roofed ? POLYCARBONATE_MIN_SLOPE : 0);
  const materials = resolveMaterials(input.materials);
  const wood = materials.treatedLumber;

  const errors: CommandError[] = [];
  for (const e of [
    requireSection(catalog, postSize, 'postSize'),
    requireSection(catalog, beamSize, 'beamSize'),
    requireSection(catalog, rafterSize, 'rafterSize'),
    roofed ? requireSection(catalog, BUILDER_DEFAULTS.sections.purlin, 'roofing') : null,
    requireMaterial(catalog, wood, ['lumber'], 'materials.treatedLumber'),
    requireMaterial(catalog, materials.concrete, ['concrete'], 'materials.concrete'),
    roofingId ? requireMaterial(catalog, roofingId, ['roofing'], 'roofing') : null,
  ]) {
    if (e) errors.push(e);
  }
  if (errors.length > 0) return fail(...errors);
  if (overhang < 0 || overhang > 3 * FT) return bad(`"overhang" must be 0 to 3' 0" (you gave ${fi(overhang)}).`, 'overhang');
  if (roofingId === D.polycarbonate && slope.ratio < POLYCARBONATE_MIN_SLOPE - 1e-6) {
    return bad(
      `Clear polycarbonate roofing needs a slope of at least 1 in 12 so water drains (the maker's minimum); you gave ${formatPitch(slope)}.`,
      'slope',
      'Leave "slope" out to use 1 in 12, or give a steeper one.',
    );
  }
  if (slope.ratio > 6 / 12 + 1e-6) return bad(`A pergola slope can be at most 6 in 12 (you gave ${formatPitch(slope)}).`, 'slope');

  // Frame: u along the beams, w across with the low row at w = 0.
  const beamAxis = input.beamAxis ?? (input.lowSide ? (input.lowSide === 'north' || input.lowSide === 'south' ? 'x' : 'z') : x1 - x0 >= z1 - z0 ? 'x' : 'z');
  const lowSide = input.lowSide ?? (beamAxis === 'x' ? 'north' : 'west');
  if ((beamAxis === 'x') !== (lowSide === 'north' || lowSide === 'south')) {
    return bad(
      `With beams along ${beamAxis}, the rafters run ${beamAxis === 'x' ? 'north-south' : 'east-west'}, so the low side must be ${beamAxis === 'x' ? 'north or south' : 'east or west'}.`,
      'lowSide',
    );
  }
  const frame: PlanFrame =
    lowSide === 'north'
      ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 0, wSign: 1 }
      : lowSide === 'south'
        ? { origin: { x: x0, y: 0, z: z1 }, angleDeg: 0, wSign: -1 }
        : lowSide === 'west'
          ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 90, wSign: -1 }
          : { origin: { x: x1, y: 0, z: z0 }, angleDeg: 90, wSign: 1 };
  const LU = beamAxis === 'x' ? x1 - x0 : z1 - z0;
  const LW = beamAxis === 'x' ? z1 - z0 : x1 - x0;

  const p = sectionDims(catalog, postSize).width;
  const beamDepth = sectionDims(catalog, beamSize).depth;
  const rafterDepth = sectionDims(catalog, rafterSize).depth;
  const r = slope.ratio;
  const cos = Math.cos(Math.atan(r));
  const sin = Math.sin(Math.atan(r));
  const hHigh = height;
  const hLow = height - (LW - p) * r;
  if (hLow < 7 * FT - 1e-6) {
    return bad(
      `The low side's beams would be ${fi(hLow)} up; a pergola needs at least 7' 0" of headroom.`,
      'height',
      'Raise "height", lower the slope, or shorten the rafter run.',
    );
  }
  if (hHigh > 12 * FT + 1e-6) return bad(`A pergola can be at most 12' 0" tall (you gave ${fi(hHigh)}).`, 'height');
  const rafterLen = (LW + 2 * overhang + 2 * T) / cos;
  if (rafterLen > STOCK_LENGTH_MM + 1e-6) {
    return bad(`The rafters would be ${fi(rafterLen)} long, past the ${fi(STOCK_LENGTH_MM)} stock length.`, 'to', 'Make the pergola narrower across the beams, or turn the beams ("beamAxis").');
  }

  // Posts along u so the beams span no more than the table allows.
  const maxSpan = PERGOLA_BEAM_MAX_SPAN_MM[beamSize]!;
  const bays = Math.max(1, Math.ceil((LU - p) / maxSpan - 1e-9));
  const postU = Array.from({ length: bays + 1 }, (_, k) => p / 2 + (k * (LU - p)) / bays);

  const footing = footingDepth(project, siteDefaults);
  const asm = '#p';
  const roofAsm = '#r';
  const step = { phase: 'framing' as const, seq: builderSeq(project, PERGOLA_BUILDER) };
  const roofStep = { phase: 'roofing' as const, seq: step.seq };
  const specs = new SpecList('g');
  const joints: JointSpec[] = [];
  const J = BUILDER_DEFAULTS.jointTypes;
  const S = BUILDER_DEFAULTS.sections;
  const at = (q: FrameVec) => {
    const w = toWorld(frame, q);
    return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
  };

  // Rows: low (w = 0..p) and high (w = LW − p..LW).
  const rows = [
    { w0: 0, top: hLow, name: 'low' },
    { w0: LW - p, top: hHigh, name: 'high' },
  ];
  const beamPlies: Array<{ ref: Ref; w0: number; top: number }> = [];
  let posts = 0;
  for (const row of rows) {
    const rowPosts: Ref[] = [];
    for (const uc of postU) {
      const post = specs.add(frame, {
        assembly: asm,
        role: 'post',
        tags: ['pergola-post', `row:${row.name}`],
        box: { u0: uc - p / 2, u1: uc + p / 2, v0: 0, v1: row.top, w0: row.w0, w1: row.w0 + p },
        lengthAxis: 'v',
        widthAxis: 'u',
        materialId: wood,
        sectionId: postSize,
        buildStep: step,
      });
      const wc = row.w0 + p / 2;
      const pier = specs.add(frame, {
        assembly: asm,
        role: 'pier',
        tags: ['post-footing', 'sonotube'],
        box: { u0: uc - PIER_HALF, u1: uc + PIER_HALF, v0: -footing.mm, v1: 0, w0: wc - PIER_HALF, w1: wc + PIER_HALF },
        lengthAxis: 'v',
        widthAxis: 'u',
        materialId: materials.concrete,
        buildStep: step,
      });
      joints.push({ a: post, b: pier, jointTypeId: J.postBase, at: at({ u: uc, v: 0, w: wc }), fastenerCount: 1 });
      joints.push({ a: pier, b: GROUND, jointTypeId: J.castInPlace, at: at({ u: uc, v: -footing.mm, w: wc }), fastenerCount: 1 });
      rowPosts.push(post);
      posts++;
    }
    // Doubled beam: one ply on each face of the posts, tops flush with the post tops.
    for (const w0 of [row.w0 - T, row.w0 + p]) {
      const ply = specs.add(frame, {
        assembly: asm,
        role: 'beam',
        tags: ['pergola-beam', `row:${row.name}`],
        box: { u0: -overhang, u1: LU + overhang, v0: row.top - beamDepth, v1: row.top, w0, w1: w0 + T },
        lengthAxis: 'u',
        widthAxis: 'w',
        materialId: wood,
        sectionId: beamSize,
        buildStep: step,
      });
      beamPlies.push({ ref: ply, w0, top: row.top });
      rowPosts.forEach((post, k) => {
        joints.push({ a: ply, b: post, jointTypeId: J.boltedThrough, at: at({ u: postU[k]!, v: row.top - beamDepth / 2, w: w0 + T / 2 }), fastenerCount: 2 });
      });
    }
  }

  // Rafters: underside through the outer top edge of the low beam (w = −T, v = hLow), so
  // they bear on both beams without cutting into them.
  const yUnder = (w: number) => hLow + (w + T) * r;
  const wStart = -T - overhang;
  const rafterAsm = roofed ? roofAsm : asm;
  const rafterStep = roofed ? roofStep : step;
  const rafterU: number[] = [0];
  for (let k = 1; k * spacing < LU - T - 1; k++) {
    const u0 = k * spacing - T / 2;
    if (u0 + T > LU - T - 0.75 * IN) break;
    rafterU.push(u0);
  }
  rafterU.push(LU - T);
  const rafters: Ref[] = [];
  for (const u0 of rafterU) {
    const placed = placeOriented(
      frame,
      { u: u0, v: yUnder(wStart), w: wStart },
      { x: { u: 0, v: sin, w: cos }, y: { u: 1, v: 0, w: 0 }, z: { u: 0, v: cos, w: -sin } },
      { length: rafterLen, width: T, height: rafterDepth },
    );
    const key = specs.addPlaced({ assembly: rafterAsm, role: 'rafter', materialId: wood, sectionId: rafterSize, tags: ['pergola-rafter'], buildStep: rafterStep, ...placed });
    rafters.push(key);
    // A tie to the beam ply the rafter bears on in each row (the lowest point over each beam).
    for (const ply of [beamPlies[0]!, beamPlies[2]!]) {
      const w = ply.w0;
      joints.push({ a: key, b: ply.ref, jointTypeId: J.hurricaneTie, at: at({ u: u0 + T / 2, v: yUnder(w), w: w + T / 2 }), fastenerCount: 1 });
    }
  }

  // Purlins and roofing panels, laid along the slope on the rafter tops. Slope distance s
  // runs from the rafters' low end; n is the distance off the rafters' underside.
  let purlinCount = 0;
  let panelCount = 0;
  const notes: string[] = [];
  if (roofed) {
    const purlin = sectionDims(catalog, S.purlin);
    const sLen = rafterLen;
    const point = (sDist: number, n: number, u: number): FrameVec => ({ u, v: yUnder(wStart) + sDist * sin + n * cos, w: wStart + sDist * cos - n * sin });
    const purlinRefs: Array<{ ref: Ref; s0: number }> = [];
    const maxGap = Math.min(POLYCARBONATE_MAX_PURLIN_MM, 24 * IN);
    const nPurlins = Math.max(2, Math.ceil((sLen - purlin.depth) / maxGap - 1e-9) + 1);
    for (let i = 0; i < nPurlins; i++) {
      const s0 = (i * (sLen - purlin.depth)) / (nPurlins - 1);
      const placed = placeOriented(
        frame,
        point(s0, rafterDepth, 0),
        { x: { u: 1, v: 0, w: 0 }, y: { u: 0, v: sin, w: cos }, z: { u: 0, v: cos, w: -sin } },
        { length: LU, width: purlin.depth, height: purlin.width },
      );
      const key = specs.addPlaced({ assembly: roofAsm, role: 'rail', materialId: wood, sectionId: S.purlin, tags: ['pergola-purlin', 'laid-flat'], buildStep: roofStep, ...placed });
      purlinRefs.push({ ref: key, s0 });
      purlinCount++;
      rafterU.forEach((u0, k) => {
        joints.push({ a: key, b: rafters[k]!, jointTypeId: J.nail16d, at: at(point(s0 + purlin.depth / 2, rafterDepth, u0 + T / 2)), fastenerCount: 2 });
      });
    }
    const cover = roofingId === D.polycarbonate ? POLYCARBONATE_COVER_MM : METAL_PANEL_COVER_MM;
    const nPanels = Math.max(1, Math.ceil(LU / cover - 1e-9));
    const nTop = rafterDepth + purlin.width;
    for (let i = 0; i < nPanels; i++) {
      const u0 = i * cover;
      const u1 = Math.min(LU, u0 + cover);
      const placed = placeOriented(
        frame,
        point(0, nTop, u0),
        { x: { u: 0, v: sin, w: cos }, y: { u: 1, v: 0, w: 0 }, z: { u: 0, v: cos, w: -sin } },
        { length: sLen, width: u1 - u0, height: PANEL_THICKNESS },
      );
      const key = specs.addPlaced({ assembly: roofAsm, role: 'sheathing', materialId: roofingId!, tags: ['roofing', 'pergola-roof'], buildStep: roofStep, ...placed });
      panelCount++;
      for (const pr of purlinRefs) {
        joints.push({
          a: key,
          b: pr.ref,
          jointTypeId: J.screwedRoofing,
          at: at(point(pr.s0 + purlin.depth / 2, nTop, (u0 + u1) / 2)),
          fastenerCount: Math.max(2, Math.ceil((u1 - u0) / (12 * IN) - 1e-9)),
        });
      }
    }
    if (roofingId === D.polycarbonate) {
      notes.push("Clear polycarbonate panels need the maker's closure strips and screws with EPDM washers; keep the slope at least 1 in 12.");
    }
    const snow = snowLoad(project, siteDefaults);
    notes.push(`The roof carries snow: I used ${snow.note}; run check_structure to check the rafters and purlins.`);
  }
  notes.push(`The piers go ${fi(footing.mm)} deep (${footing.note}).`);

  const name = input.name ?? 'Pergola';
  const roofName = `${name} roof`;
  const params = {
    from: { x: x0, z: z0 },
    to: { x: x1, z: z1 },
    height,
    postSize,
    beamSize,
    beamAxis,
    rafterSize,
    rafterSpacing: spacingLabel,
    overhang,
    roofing: roofingId ?? 'none',
    slopeRise: round6(slope.rise),
    lowSide,
    materials,
  };
  const roofingName = roofingId ? (catalog.materials.get(roofingId)?.name ?? roofingId).toLowerCase() : '';
  return {
    ok: true,
    layout: {
      assemblies: [
        { key: asm, kind: 'misc', name, buildStep: step, builder: () => ({ name: PERGOLA_BUILDER, params }) },
        ...(roofed
          ? [
              {
                key: roofAsm,
                kind: 'roof' as const,
                name: roofName,
                buildStep: roofStep,
                builder: (id: (ref: Ref) => string) => ({ name: PERGOLA_BUILDER, params: { part: 'roof', frame: id(asm) } }),
              },
            ]
          : []),
      ],
      parts: specs.parts,
      joints,
      notes,
      what: 'The new pergola',
      summary: (id) =>
        `Built pergola ${id(asm)} "${name}": ${fi(LU)} × ${fi(LW)}, ${posts} ${postSize} posts on piers, doubled ${beamSize} beams, ${rafters.length} ${rafterSize} rafters at ${spacingLabel}` +
        (slope.ratio > 0 ? ` sloping ${formatPitch(slope)} down to the ${lowSide}` : '') +
        (roofed ? `; roof ${id(roofAsm)} with ${purlinCount} 2x4 purlins and ${panelCount} ${roofingName} panels.` : '.'),
    },
  };
}
