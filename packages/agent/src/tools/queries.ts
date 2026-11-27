/**
 * The read-only query tools: find_parts, get_part, measure, list_materials and
 * search_catalog. Pure
 * functions over (project, catalog): they never change the project, and they answer in
 * compact text with every length in feet and inches.
 */
import {
  MM_PER_FOOT,
  aabbOf,
  commandError,
  describeCuts,
  getAssembly,
  getPart,
  hasCuts,
  jointsForPart,
  notFound,
  partBox,
  partSolidAabb,
  zodIssuesToErrors,
  type Aabb,
  type CatalogIndex,
  type CommandError,
  type Part,
  type Project,
} from '@slapdash/core';
import type { z } from 'zod';
import { compareIds, ft, ftMm, plural } from '../format.ts';
import { zFindParts, zGetPart, zListMaterials, zMeasure, zSearchCatalog, type QueryPoint } from './schemas.ts';

export type QueryResult = { ok: true; text: string } | { ok: false; errors: CommandError[] };

type Query = (project: Project, catalog: CatalogIndex, rawInput: unknown) => QueryResult;

function parsed<S extends z.ZodType>(schema: S, raw: unknown): { ok: true; data: z.output<S> } | { ok: false; errors: CommandError[] } {
  const res = schema.safeParse(raw ?? {});
  return res.success ? { ok: true, data: res.data } : { ok: false, errors: zodIssuesToErrors(res.error.issues, raw) };
}

const sortedParts = (project: Project): Part[] => Object.values(project.parts).sort((a, b) => compareIds(a.id, b.id));

function unknownAssembly(project: Project, id: string, path: string): CommandError {
  return notFound('assembly', id, Object.keys(project.assemblies), path);
}

function unknownId(project: Project, id: string, path: string): CommandError {
  return notFound('part or assembly', id, [...Object.keys(project.assemblies), ...Object.keys(project.parts)], path);
}

function union(boxes: Aabb[]): Aabb | undefined {
  if (boxes.length === 0) return undefined;
  const min = { ...boxes[0]!.min };
  const max = { ...boxes[0]!.max };
  for (const b of boxes) {
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

/** A part's world bounds: its cut solid's when it has cuts (tighter than its box). */
export const partAabb = (part: Part): Aabb => (hasCuts(part) ? partSolidAabb(part) : aabbOf(partBox(part)));

/** Bounds of some parts, or undefined when there are none. */
export function boundsOf(parts: readonly Part[]): Aabb | undefined {
  return union(parts.map(partAabb));
}

export function describeBounds(b: Aabb): string {
  return `${ft(b.max.x - b.min.x)} E–W × ${ft(b.max.z - b.min.z)} N–S × ${ft(b.max.y - b.min.y)} tall, from (${ft(b.min.x)}, ${ft(b.min.z)}) to (${ft(b.max.x)}, ${ft(b.max.z)}), ${ft(b.min.y)} to ${ft(b.max.y)} high`;
}

/** Distance from a point to a box (0 inside). */
function distanceToBox(p: { x: number; y: number; z: number }, b: Aabb): number {
  const d = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  return Math.hypot(d(p.x, b.min.x, b.max.x), d(p.y, b.min.y, b.max.y), d(p.z, b.min.z, b.max.z));
}

function materialLabel(part: Part): string {
  return part.sectionId ? `${part.materialId}/${part.sectionId}` : part.materialId;
}

function partRow(part: Part, extra = ''): string {
  return [part.id, part.role, part.name ?? '—', part.assemblyId, materialLabel(part), ft(part.size.length)].join(' · ') + extra;
}

// ── find_parts ──────────────────────────────────────────────────────────────

export const findParts: Query = (project, _catalog, raw) => {
  const p = parsed(zFindParts, raw);
  if (!p.ok) return p;
  const q = p.data;
  if (q.assembly !== undefined && !getAssembly(project, q.assembly)) return { ok: false, errors: [unknownAssembly(project, q.assembly, 'assembly')] };
  if (q.within !== undefined && q.near === undefined) {
    return { ok: false, errors: [commandError('invalid_input', '"within" only works with "near".', { path: 'within', hint: 'Add a "near" point.' })] };
  }
  const material = q.material?.toLowerCase();
  let rows = sortedParts(project).filter(
    (part) =>
      (q.assembly === undefined || part.assemblyId === q.assembly) &&
      (q.role === undefined || part.role === q.role) &&
      (material === undefined || part.materialId.toLowerCase().includes(material)) &&
      (q.tag === undefined || part.tags.includes(q.tag)),
  );
  let distances: Map<string, number> | undefined;
  if (q.near) {
    const at = { x: q.near.x, y: q.near.y ?? 0, z: q.near.z };
    const within = q.within ?? MM_PER_FOOT;
    distances = new Map(rows.map((part) => [part.id, distanceToBox(at, partAabb(part))]));
    rows = rows.filter((part) => distances!.get(part.id)! <= within).sort((a, b) => distances!.get(a.id)! - distances!.get(b.id)!);
  }
  if (rows.length === 0) return { ok: true, text: 'No parts match.' };
  const shown = rows.slice(0, q.limit);
  const lines = [`${plural(rows.length, 'part matches', 'parts match')}.`, 'id · role · name · assembly · material/section · length'];
  for (const part of shown) {
    const d = distances?.get(part.id);
    lines.push(partRow(part, d === undefined ? '' : ` · ${ft(d)} away`));
  }
  if (rows.length > shown.length) lines.push(`…and ${rows.length - shown.length} more; narrow with role or assembly.`);
  return { ok: true, text: lines.join('\n') };
};

// ── get_part ────────────────────────────────────────────────────────────────

/** Recipe params that are lengths in mm. */
const LENGTH_KEYS = new Set([
  'x',
  'z',
  'length',
  'height',
  'studLength',
  'baseElevation',
  'depth',
  'spacing',
  'thickness',
  'top',
  'footingDepth',
  'width',
  'overhang',
  'rake',
  'bearingHeight',
  'at',
  'roBottom',
  'roTop',
  'sillHeight',
  'poolDepth',
  'canopy',
  'postSpacing',
  'sheathingThickness',
]);
/** Internal layout bookkeeping, not useful to Claude. */
const SKIP_KEYS = new Set(['frameU0', 'frameU1', 'sheathU0', 'sheathU1', 'framingU0', 'framingU1', 'seq', 'snowPsf', 'buildingWidthFt']);

function formatParam(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return LENGTH_KEYS.has(key) ? ft(value) : String(Number(value.toFixed(3)));
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatParam(key, v)).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => !SKIP_KEYS.has(k));
    return `{ ${entries.map(([k, v]) => `${k}: ${formatParam(k, v)}`).join(', ')} }`;
  }
  return String(value);
}

/** `Cuts: …` and the long-point note, or nothing for a plain box. */
function cutLines(part: Part): string[] {
  if (!hasCuts(part)) return [];
  const d = describeCuts(part);
  return [`Cuts: ${d.label}`, ...(d.longPoint ? ['Length is the long point.'] : [])];
}

function describePart(project: Project, catalog: CatalogIndex, part: Part): string {
  const asm = getAssembly(project, part.assemblyId);
  const material = catalog.materials.get(part.materialId);
  const section = part.sectionId ? catalog.sections.get(part.sectionId) : undefined;
  const s = part.size;
  const lines = [
    `${part.id} · ${part.role}${part.name ? ` "${part.name}"` : ''} · in ${part.assemblyId}${asm ? ` "${asm.name}"` : ''}`,
    `Material: ${part.materialId}${material ? ` (${material.name})` : ''}${part.sectionId ? `, section ${part.sectionId}${section?.nominal ? ` (${section.nominal})` : ''}` : ''}`,
    `Size: ${ft(s.length)} long × ${ft(s.width)} × ${ft(s.height)} (${Math.round(s.length)} × ${Math.round(s.width)} × ${Math.round(s.height)} mm)`,
    ...cutLines(part),
    `Position (start corner): x ${ft(part.position.x)}, y ${ft(part.position.y)}, z ${ft(part.position.z)}`,
    `Rotation: x ${part.rotation.x}°, y ${part.rotation.y}°, z ${part.rotation.z}°`,
    `Build step: ${part.buildStep.phase}${part.buildStep.seq !== undefined ? ` #${part.buildStep.seq}` : ''}`,
    `Tags: ${part.tags.length > 0 ? part.tags.join(', ') : 'none'}`,
  ];
  const joints = jointsForPart(project, part.id).sort((a, b) => compareIds(a.id, b.id));
  if (joints.length === 0) {
    lines.push('Joints: none');
  } else {
    lines.push(`Joints (${joints.length}):`);
    for (const j of joints.slice(0, 30)) {
      const other = j.partIds[0] === part.id ? j.partIds[1] : j.partIds[0];
      lines.push(`- ${j.id} ${j.jointTypeId} with ${other} (${j.fastenerCount} fastener${j.fastenerCount === 1 ? '' : 's'})`);
    }
    if (joints.length > 30) lines.push(`…and ${joints.length - 30} more.`);
  }
  return lines.join('\n');
}

function describeAssembly(project: Project, id: string): string {
  const asm = project.assemblies[id]!;
  const parts = Object.values(project.parts).filter((p) => p.assemblyId === id);
  const lines = [`${asm.id} "${asm.name}" (${asm.kind}) · ${plural(parts.length, 'part')} · level ${asm.levelId}`];
  if (asm.buildStep) lines.push(`Build step: ${asm.buildStep.phase}${asm.buildStep.seq !== undefined ? ` #${asm.buildStep.seq}` : ''}`);
  if (asm.builder) {
    lines.push(`Made by ${asm.builder.name}:`);
    for (const [k, v] of Object.entries(asm.builder.params)) {
      if (!SKIP_KEYS.has(k)) lines.push(`- ${k}: ${formatParam(k, v)}`);
    }
  } else {
    lines.push('Made by hand (no builder recipe).');
  }
  const byRole = new Map<string, number>();
  for (const p of parts) byRole.set(p.role, (byRole.get(p.role) ?? 0) + 1);
  if (byRole.size > 0) lines.push(`Parts by role: ${[...byRole].map(([r, n]) => `${n} ${r}`).join(', ')}`);
  const b = boundsOf(parts);
  if (b) lines.push(`Bounds: ${describeBounds(b)}`);
  return lines.join('\n');
}

export const getPartInfo: Query = (project, catalog, raw) => {
  const p = parsed(zGetPart, raw);
  if (!p.ok) return p;
  const id = p.data.id;
  const part = getPart(project, id);
  if (part) return { ok: true, text: describePart(project, catalog, part) };
  if (getAssembly(project, id)) return { ok: true, text: describeAssembly(project, id) };
  return { ok: false, errors: [unknownId(project, id, 'id')] };
};

// ── measure ─────────────────────────────────────────────────────────────────

type Target = { label: string; box: Aabb } | { error: CommandError };

function resolveTarget(project: Project, t: string | QueryPoint, path: string): Target {
  if (typeof t !== 'string') {
    const at = { x: t.x, y: t.y ?? 0, z: t.z };
    return { label: `point (${ft(at.x)}, ${ft(at.y)}, ${ft(at.z)})`, box: { min: at, max: at } };
  }
  const part = getPart(project, t);
  if (part) return { label: part.id, box: partAabb(part) };
  if (getAssembly(project, t)) {
    const b = boundsOf(Object.values(project.parts).filter((p) => p.assemblyId === t));
    if (!b) return { error: commandError('not_allowed', `${t} has no parts to measure.`, { path }) };
    return { label: t, box: b };
  }
  return { error: unknownId(project, t, path) };
}

const center = (b: Aabb) => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 });

export const measure: Query = (project, _catalog, raw) => {
  const p = parsed(zMeasure, raw);
  if (!p.ok) return p;
  const a = resolveTarget(project, p.data.from, 'from');
  const b = resolveTarget(project, p.data.to, 'to');
  const errors = [a, b].flatMap((t) => ('error' in t ? [t.error] : []));
  if ('error' in a || 'error' in b) return { ok: false, errors };
  const ca = center(a.box);
  const cb = center(b.box);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const dz = cb.z - ca.z;
  const axes = ['x', 'y', 'z'] as const;
  const gaps = axes.map((k) => Math.max(0, a.box.min[k] - b.box.max[k], b.box.min[k] - a.box.max[k]));
  const lines = [
    `From ${a.label} to ${b.label}:`,
    `Centre to centre: ${ftMm(Math.hypot(dx, dy, dz))}`,
    `dx (east +): ${ftMm(dx)} · dy (up +): ${ftMm(dy)} · dz (south +): ${ftMm(dz)}`,
  ];
  if (gaps.some((g) => g > 1e-6)) {
    const clear = Math.hypot(...gaps);
    const along = axes.filter((_, i) => gaps[i]! > 1e-6);
    lines.push(`Clear gap between them: ${ftMm(clear)}${along.length === 1 ? ` (along ${along[0]})` : ''}`);
  } else {
    const overlaps = axes.map((k) => Math.min(a.box.max[k], b.box.max[k]) - Math.max(a.box.min[k], b.box.min[k]));
    const depth = Math.min(...overlaps);
    lines.push(depth > 1e-6 ? `They overlap by ${ftMm(depth)} (their bounds touch or intersect).` : 'They touch (no gap).');
  }
  return { ok: true, text: lines.join('\n') };
};

// ── list_materials ──────────────────────────────────────────────────────────

const SQFT = MM_PER_FOOT * MM_PER_FOOT;
const CUBIC_YARD_MM3 = (3 * MM_PER_FOOT) ** 3;
/** A full 4×8 sheet, in ft². */
const SHEET_FT2 = 32;

export const listMaterials: Query = (project, catalog, raw) => {
  const p = parsed(zListMaterials, raw);
  if (!p.ok) return p;
  const only = p.data.assembly;
  if (only !== undefined && !getAssembly(project, only)) return { ok: false, errors: [unknownAssembly(project, only, 'assembly')] };
  const parts = sortedParts(project).filter((part) => (only === undefined || part.assemblyId === only) && part.materialId !== 'site-context');
  if (parts.length === 0) return { ok: true, text: only ? `${only} has no parts.` : 'The project has no parts yet.' };

  type Group = { key: string; material: string; section?: string; kind: 'member' | 'sheet' | 'concrete' | 'other'; count: number; lengthMm: number; areaMm2: number; volumeMm3: number };
  const groups = new Map<string, Group>();
  for (const part of parts) {
    const mat = catalog.materials.get(part.materialId);
    const sec = part.sectionId ? catalog.sections.get(part.sectionId) : undefined;
    const kind: Group['kind'] =
      mat?.category === 'concrete' || mat?.category === 'masonry'
        ? 'concrete'
        : mat?.category === 'sheet' || sec?.shape === 'sheet'
          ? 'sheet'
          : part.sectionId
            ? 'member'
            : 'other';
    const key = `${part.materialId}|${part.sectionId ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, material: mat?.name ?? part.materialId, kind, count: 0, lengthMm: 0, areaMm2: 0, volumeMm3: 0 };
      if (part.sectionId) g.section = sec?.nominal ?? part.sectionId;
      groups.set(key, g);
    }
    g.count++;
    g.lengthMm += part.size.length;
    g.areaMm2 += part.size.length * part.size.width;
    g.volumeMm3 += part.size.length * part.size.width * part.size.height;
  }

  const lines = [`Materials for ${only ?? 'the whole project'} (${plural(parts.length, 'part')}):`];
  const ordered = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const g of ordered) {
    const name = g.section ? `${g.material} ${g.section}` : g.material;
    switch (g.kind) {
      case 'member':
        lines.push(`- ${name}: ${plural(g.count, 'piece')}, ${Math.round(g.lengthMm / MM_PER_FOOT)} linear ft`);
        break;
      case 'sheet': {
        const ft2 = g.areaMm2 / SQFT;
        lines.push(`- ${name}: ${plural(g.count, 'piece')}, ${Math.round(ft2)} ft², about ${plural(Math.ceil(ft2 / SHEET_FT2 - 1e-9), '4×8 sheet')}`);
        break;
      }
      case 'concrete':
        lines.push(`- ${name}: ${plural(g.count, 'piece')}, ${(g.volumeMm3 / CUBIC_YARD_MM3).toFixed(2)} yd³`);
        break;
      default:
        lines.push(`- ${name}: ${plural(g.count, 'piece')}`);
    }
  }

  const ids = new Set(parts.map((x) => x.id));
  const fasteners = new Map<string, number>();
  for (const j of Object.values(project.joints)) {
    if (!ids.has(j.partIds[0]) && !ids.has(j.partIds[1])) continue;
    const type = catalog.jointTypes.get(j.jointTypeId);
    // Joints with no hardware (cast in place, mortared) consume no fasteners.
    if (!type || (type.hardwareId === undefined && type.fastener === undefined)) continue;
    const hw = type.hardwareId ? catalog.materials.get(type.hardwareId) : undefined;
    const label = hw?.name ?? type.fastener!;
    const n = type.capacity.basis === 'per-fastener' ? j.fastenerCount : 1;
    fasteners.set(label, (fasteners.get(label) ?? 0) + n);
  }
  if (fasteners.size > 0) {
    lines.push('Fasteners and connectors (from the joints):');
    for (const [label, n] of [...fasteners].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${label}: ${n}`);
  }
  lines.push('Quantities only; prices come later. No waste allowance is included.');
  return { ok: true, text: lines.join('\n') };
};

// ── search_catalog ──────────────────────────────────────────────────────────

const DESCRIPTION_CLIP = 100;

/** Catalog materials matching words, a category and a flag, in catalog order. */
export const searchCatalog: Query = (_project, catalog, raw) => {
  const p = parsed(zSearchCatalog, raw);
  if (!p.ok) return p;
  const words = (p.data.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...catalog.materials.values()].filter((m) => {
    if (m.category === 'site') return false;
    if (p.data.category !== undefined && m.category !== p.data.category) return false;
    if (p.data.flag !== undefined && !(m.flags ?? []).includes(p.data.flag)) return false;
    const hay = `${m.id} ${m.name} ${m.description ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (matches.length === 0) return { ok: true, text: 'No materials match. Try fewer words, or search by category.' };
  const shown = matches.slice(0, p.data.limit);
  const lines = [`${plural(matches.length, 'material')} match${matches.length === 1 ? 'es' : ''}.`];
  for (const m of shown) {
    const flags = m.flags && m.flags.length > 0 ? m.flags.join(', ') : 'no flags';
    lines.push(`- ${m.id} · ${m.name} · ${m.category} · ${flags}`);
    if (m.description) {
      const d = m.description.length > DESCRIPTION_CLIP ? `${m.description.slice(0, DESCRIPTION_CLIP - 1).trimEnd()}…` : m.description;
      lines.push(`  ${d}`);
    }
  }
  if (matches.length > shown.length) lines.push(`…and ${matches.length - shown.length} more; narrow the search or raise "limit".`);
  return { ok: true, text: lines.join('\n') };
};

export const QUERY_TOOLS: Readonly<Record<string, Query>> = {
  find_parts: findParts,
  get_part: getPartInfo,
  measure,
  list_materials: listMaterials,
  search_catalog: searchCatalog,
};
