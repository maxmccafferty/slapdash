/**
 * The compact `<project>` block that starts every message from the person, so Claude knows
 * the ids and key sizes without asking for everything. Deterministic: the same project gives
 * the same text. Detail comes from the query tools.
 */
import {
  DESIGN_LOAD_KEYS,
  codeNotes,
  formatLoad,
  isUnitPart,
  resolveDesignLoads,
  type Assembly,
  type CatalogIndex,
  type DesignLoadKey,
  type Part,
  type Project,
  type SiteDefaults,
} from '@slapdash/core';
import { clip, compareIds, ft, plural } from './format.ts';
import { boundsOf } from './tools/queries.ts';

export interface SummaryOptions {
  siteDefaults?: SiteDefaults;
  /** Names of saved versions. */
  versions?: readonly string[];
  /** The plan from the previous turn, waiting for the person's answer. */
  pendingPlan?: string | null;
  /** The big-change check: true when the person asked for plans first. Default false. */
  confirmBigChanges?: boolean;
  /** Assembly lines before "…N more". Default 40. */
  maxAssemblies?: number;
  /** The catalog, for code notes. Without it the summary has none. */
  catalog?: CatalogIndex;
}

const MAX_CODE_NOTES = 6;
const REMINDER_PREFIX = 'Reminder (not a code check): ';

const LOAD_WORDS: Record<DesignLoadKey, string> = { groundSnow: 'snow', windSpeed: 'wind', frostDepth: 'frost' };

type Pt = { x: number; z: number };
const isPt = (v: unknown): v is Pt => typeof v === 'object' && v !== null && typeof (v as Pt).x === 'number' && typeof (v as Pt).z === 'number';
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pt = (p: Pt) => `(${ft(p.x)}, ${ft(p.z)})`;

/** Key dimensions from the builder recipe, or the bounds when there is none. */
function keyDimensions(asm: Assembly, parts: readonly Part[], catalog?: CatalogIndex): string {
  const p = asm.builder?.params ?? {};
  switch (asm.builder?.name) {
    case 'pour_slab':
      if (isPt(p.from) && isPt(p.to)) {
        const t = num(p.thickness);
        return `${ft(Math.abs(p.to.x - p.from.x))} × ${ft(Math.abs(p.to.z - p.from.z))}${t ? ` × ${ft(t)}` : ''}`;
      }
      break;
    case 'build_wall':
      if (isPt(p.start) && isPt(p.end)) {
        const h = num(p.height);
        const len = num(p.length);
        return `${pt(p.start)}→${pt(p.end)}${len ? ` · ${ft(len)} long` : ''}${h ? ` · ${ft(h)} high` : ''}`;
      }
      break;
    case 'add_opening': {
      const w = num(p.width);
      const h = num(p.height);
      const at = num(p.at);
      if (w && h) {
        return `${ft(w)} × ${ft(h)} ${String(p.kind ?? 'opening')} RO in ${String(p.wallId)}${at !== undefined ? ` · from ${ft(at)} along the wall` : ''}${unitWords(p, catalog)}`;
      }
      break;
    }
    case 'frame_floor':
      if (isPt(p.from) && isPt(p.to)) {
        const top = num(p.top);
        return `${ft(Math.abs(p.to.x - p.from.x))} × ${ft(Math.abs(p.to.z - p.from.z))} · ${String(p.joistSize)} joists${top !== undefined ? ` · top ${ft(top)}` : ''}`;
      }
      break;
    case 'build_roof':
      if (isPt(p.from) && isPt(p.to)) {
        const rise = num(p.pitchRise);
        const pitch = rise !== undefined ? ` ${Number(rise.toFixed(2))}/12` : '';
        const ridge = p.ridgeAxis === 'x' ? ' ridge E–W' : p.ridgeAxis === 'z' ? ' ridge N–S' : p.lowSide ? ` low side ${String(p.lowSide)}` : '';
        return `${String(p.type)}${pitch}${ridge} over ${ft(Math.abs(p.to.x - p.from.x))} × ${ft(Math.abs(p.to.z - p.from.z))}`;
      }
      break;
    case 'build_fence': {
      const path = Array.isArray(p.path) ? p.path.filter(isPt) : [];
      let run = 0;
      for (let i = 1; i < path.length; i++) run += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
      const h = num(p.height);
      const gates = Array.isArray(p.gates) && p.gates.length > 0 ? ` · ${plural(p.gates.length, 'gate')}` : '';
      return `${ft(run)} run${h ? ` · ${ft(h)} high` : ''} · ${String(p.style ?? '')}${gates}${p.poolBarrier === true ? ' · pool barrier' : ''}`.trim();
    }
    case 'build_pergola': {
      if (p.part === 'roof') return `roof of ${String(p.frame)}`;
      if (isPt(p.from) && isPt(p.to)) {
        const h = num(p.height);
        const roof = p.roofing && p.roofing !== 'none' ? ` · ${String(p.roofing)} roof` : ' · open';
        return `${ft(Math.abs(p.to.x - p.from.x))} × ${ft(Math.abs(p.to.z - p.from.z))}${h ? ` · ${ft(h)} high` : ''}${roof}`;
      }
      break;
    }
    case 'build_deck': {
      if (p.part === 'railing' || p.part === 'stairs') return `${String(p.part)} of ${String(p.deck)}`;
      if (isPt(p.from) && isPt(p.to)) {
        const h = num(p.height);
        return `${ft(Math.abs(p.to.x - p.from.x))} × ${ft(Math.abs(p.to.z - p.from.z))}${h !== undefined ? ` · ${ft(h)} up` : ''} · ${String(p.joistSize)} joists · ${String(p.railing)} guard`;
      }
      break;
    }
    case 'place_structure':
      return `${String(p.kind)} at ${isPt(p.at) ? pt(p.at) : '?'} (site context)`;
  }
  const b = boundsOf(parts);
  return b ? `${ft(b.max.x - b.min.x)} × ${ft(b.max.z - b.min.z)} × ${ft(b.max.y - b.min.y)}` : 'empty';
}

/** " · casement unit, white vinyl (Casement window)": the window or door drawn in an opening, from its recipe. */
function unitWords(p: Record<string, unknown>, catalog: CatalogIndex | undefined): string {
  if (typeof p.style !== 'string') return '';
  const product = typeof p.product === 'string' ? catalog?.materials.get(p.product) : undefined;
  const generic = typeof p.product !== 'string' ? [...(catalog?.materials.values() ?? [])].find((m) => m.category === 'opening' && m.unit && !m.unit.style) : undefined;
  const finish = (product ?? generic)?.unit?.finish;
  return ` · ${p.style} unit${finish ? `, ${finish}` : ''}${product ? ` (${product.name})` : ''}`;
}

/** "13 parts", or for an opening with a unit "1 unit (13 parts)" (plus any other parts). */
function partCount(asm: Assembly, own: readonly Part[]): string {
  if (asm.kind !== 'opening') return plural(own.length, 'part');
  const unit = own.filter(isUnitPart).length;
  if (unit === 0) return plural(own.length, 'part');
  const rest = own.length - unit;
  return `1 unit (${plural(unit, 'part')})${rest > 0 ? ` + ${plural(rest, 'part')}` : ''}`;
}

function siteLine(project: Project, defaults: SiteDefaults | undefined): string {
  const site = resolveDesignLoads(project, defaults);
  const bits: string[] = [];
  const missing = site.location && defaults?.table && !site.locationInTable ? ', not in loads table' : '';
  bits.push(site.location ? `${site.location.label} (${site.location.source}${missing})` : 'location not set');
  for (const key of DESIGN_LOAD_KEYS) {
    const v = site.loads[key];
    bits.push(v ? `${LOAD_WORDS[key]} ${formatLoad(key, v.value)} (${v.origin === 'project' ? `yours: ${v.source}` : v.source})` : `${LOAD_WORDS[key]} not set`);
  }
  return `Site: ${bits.join(' · ')}`;
}

/** The `<project>` … `</project>` block. */
export function projectSummary(project: Project, opts: SummaryOptions = {}): string {
  const parts = Object.values(project.parts);
  const lines = [
    `Name: ${project.name} · units ${project.units.display} · ${plural(parts.length, 'part')} · ${plural(Object.keys(project.joints).length, 'joint')}`,
    siteLine(project, opts.siteDefaults),
  ];
  const b = boundsOf(parts);
  lines.push(
    b
      ? `Bounds: ${ft(b.max.x - b.min.x)} E–W × ${ft(b.max.z - b.min.z)} N–S × ${ft(b.max.y - b.min.y)} tall (origin SW corner, +x east, +z south)`
      : 'Bounds: nothing built yet (origin SW corner, +x east, +z south)',
  );

  const byAssembly = new Map<string, Part[]>();
  for (const part of parts) {
    const list = byAssembly.get(part.assemblyId);
    if (list) list.push(part);
    else byAssembly.set(part.assemblyId, [part]);
  }
  const assemblies = Object.values(project.assemblies).sort((x, y) => compareIds(x.id, y.id));
  if (assemblies.length === 0) {
    lines.push('Assemblies: none');
  } else {
    lines.push('Assemblies:');
    const max = opts.maxAssemblies ?? 40;
    for (const asm of assemblies.slice(0, max)) {
      const own = byAssembly.get(asm.id) ?? [];
      lines.push(`- ${asm.id} ${asm.name} (${asm.kind}) ${keyDimensions(asm, own, opts.catalog)} · ${partCount(asm, own)}`);
    }
    if (assemblies.length > max) lines.push(`- …${assemblies.length - max} more; use find_parts`);
  }
  if (opts.catalog) {
    const notes = codeNotes(project, opts.catalog);
    if (notes.length > 0) {
      lines.push('Code notes (reminders, not a code check):');
      for (const n of notes.slice(0, MAX_CODE_NOTES)) lines.push(`- ${n.text.startsWith(REMINDER_PREFIX) ? n.text.slice(REMINDER_PREFIX.length) : n.text} (${n.source})`);
      if (notes.length > MAX_CODE_NOTES) lines.push(`- …${notes.length - MAX_CODE_NOTES} more`);
    }
  }
  if (opts.versions && opts.versions.length > 0) lines.push(`Saved versions: ${opts.versions.join(', ')}`);
  if (opts.pendingPlan) lines.push(`Pending plan: "${clip(opts.pendingPlan, 300)}"`);
  lines.push(`Big-change check: ${opts.confirmBigChanges === true ? 'on (plan before big changes)' : 'off (just build)'}`);
  return `<project>\n${lines.join('\n')}\n</project>`;
}
