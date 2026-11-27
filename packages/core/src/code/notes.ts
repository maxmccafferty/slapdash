/**
 * Code notes (ADR-0001 §12): reminders computed from the project, the catalog's flags and
 * the site, never a code check. Each note names the parts it is about, cites the code
 * section it comes from and ends "Check with your building department." The flag
 * vocabulary lives in `@slapdash/catalog` (`src/flags.ts`); the rules live here because
 * they need geometry.
 *
 * Notes are deterministic and sorted by key. A key is the rule plus the sorted ids it is
 * about, so a caller can diff two sets of notes to find the new ones.
 */
import type { Catalog, Material } from '../catalog/schema.ts';
import { indexCatalog, isCatalogIndex, type CatalogIndex } from '../catalog/validate.ts';
import { aabbOf, partBox, type Aabb } from '../geometry/obb.ts';
import { isBuiltPart } from '../materials/steps.ts';
import { isUnitPart, unitOpeningId } from '../model/opening-unit.ts';
import type { Part, Project } from '../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../units/length.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;

export interface CodeNote {
  /** Rule plus the sorted ids it is about, e.g. "safety-glazing-near-pool:O1-PN01". */
  key: string;
  /** The catalog flag (or rule name) the note comes from. */
  flag: string;
  /** Part (or assembly) ids the note is about, sorted. */
  ids: string[];
  /** The reminder, in plain words. */
  text: string;
  /** The code section it comes from. */
  source: string;
}

const REMINDER = 'Reminder (not a code check):';
const CHECK = 'Check with your building department.';
/** IRC R308.4.5: glazing within 60 in of the water's edge and less than 60 in above the walking surface. */
const GLAZING_NEAR_WATER_MM = 60 * IN;
/** NEC 680.22(A)(3): no receptacles within 6 ft of the inside wall of a pool. */
const NO_RECEPTACLE_MM = 6 * FT;
/** NEC 680.22(A)(4): receptacles within 20 ft of the pool need GFCI protection. */
const GFCI_NEAR_POOL_MM = 20 * FT;
/** A fence this close to a pool is likely meant as its barrier. */
const FENCE_NEAR_POOL_MM = 20 * FT;
const GENERIC_UNIT = 'opening-unit';

/** Plan distance between two boxes (0 when they overlap in plan). */
function planGap(a: Aabb, b: Aabb): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dz);
}

const list = (ids: readonly string[], max = 6) => (ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`);
const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();

function note(rule: string, flag: string, ids: Iterable<string>, text: string, source: string): CodeNote {
  const s = sorted(ids);
  return { key: `${rule}:${s.join(',')}`, flag, ids: s, text: `${REMINDER} ${text} ${CHECK}`, source };
}

/** Code reminders for a project, sorted by key. */
export function codeNotes(project: Project, catalog: Catalog | CatalogIndex): CodeNote[] {
  const idx = isCatalogIndex(catalog) ? catalog : indexCatalog(catalog);
  const out: CodeNote[] = [];
  const mat = (p: Part): Material | undefined => idx.materials.get(p.materialId);
  const has = (p: Part, flag: string) => mat(p)?.flags?.includes(flag) ?? false;
  const built = Object.values(project.parts)
    .filter((p) => isBuiltPart(p, idx))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const box = new Map<string, Aabb>();
  const aabb = (p: Part) => {
    let b = box.get(p.id);
    if (!b) {
      b = aabbOf(partBox(p));
      box.set(p.id, b);
    }
    return b;
  };
  const pools = Object.values(project.parts)
    .filter((p) => p.tags.includes('kind:pool') && p.tags.includes('water'))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const nearestPool = (p: Part) => Math.min(...pools.map((w) => planGap(aabb(p), aabb(w))));

  // 1. Safety glazing near a pool (IRC R308.4.5).
  if (pools.length > 0) {
    // A window or door unit gets one note about its glass, not one per lite.
    const unitGlass = new Map<string, { m: Material; ids: string[] }>();
    for (const p of built) {
      const m = mat(p);
      if (!m) continue;
      if (isUnitPart(p) && p.role !== 'glass') continue;
      const glazed = m.category === 'opening' || m.flags?.includes('safety-glazing') || m.flags?.includes('not-safety-glazing');
      if (!glazed) continue;
      const safe = p.tags.includes('safety-glazing') || (m.flags?.includes('safety-glazing') ?? false);
      const unsafe = !safe && (m.flags?.includes('not-safety-glazing') || m.id === GENERIC_UNIT);
      if (!unsafe) continue;
      if (aabb(p).min.y >= GLAZING_NEAR_WATER_MM || nearestPool(p) >= GLAZING_NEAR_WATER_MM) continue;
      if (isUnitPart(p)) {
        const id = unitOpeningId(p);
        const u = unitGlass.get(id) ?? { m, ids: [] };
        u.ids.push(p.id);
        unitGlass.set(id, u);
        continue;
      }
      out.push(
        note(
          'safety-glazing-near-pool',
          'safety-glazing',
          [p.id],
          `${p.id} (${m.name.toLowerCase()}) is within 5ft of the pool and less than 5ft up, so its glass must be tempered or laminated safety glazing. Re-add the opening with "safetyGlazing": true, or pick a tempered product.`,
          'IRC R308.4.5',
        ),
      );
    }
    for (const [openingId, { m, ids }] of unitGlass) {
      out.push(
        note(
          'safety-glazing-near-pool',
          'safety-glazing',
          ids,
          `${openingId}'s glass (${m.name.toLowerCase()}) is within 5ft of the pool and less than 5ft up, so it must be tempered or laminated safety glazing. Re-add the opening with "safetyGlazing": true, or pick a tempered product.`,
          'IRC R308.4.5',
        ),
      );
    }
  }

  // 2. Receptacles near a pool and outdoors (NEC 680.22(A), 210.8).
  for (const p of built) {
    const needs = has(p, 'receptacle-needs-gfci');
    const gfci = has(p, 'gfci');
    if (!needs && !gfci) continue;
    const d = pools.length > 0 ? nearestPool(p) : Infinity;
    if (d < NO_RECEPTACLE_MM) {
      out.push(note('receptacle-near-pool', needs ? 'receptacle-needs-gfci' : 'gfci', [p.id], `${p.id} is within 6ft of the pool: no receptacles are allowed that close to the water.`, 'NEC 680.22(A)(3)'));
      continue;
    }
    if (!needs) continue;
    const outdoors = project.assemblies[p.assemblyId]?.kind !== 'wall';
    if (d < GFCI_NEAR_POOL_MM || outdoors) {
      out.push(
        note(
          'receptacle-needs-gfci',
          'receptacle-needs-gfci',
          [p.id],
          `${p.id} is an ordinary receptacle ${d < GFCI_NEAR_POOL_MM ? 'within 20ft of the pool' : 'outdoors'}: it needs GFCI protection (a GFCI receptacle or breaker).`,
          d < GFCI_NEAR_POOL_MM ? 'NEC 680.22(A)(4)' : 'NEC 210.8(A)',
        ),
      );
    }
  }

  // 3. Pool barriers (IRC Appendix AG105 / ISPSC 305).
  if (pools.length > 0) {
    const fences = Object.values(project.assemblies)
      .filter((a) => a.builder?.name === 'build_fence')
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const barriers = fences.filter((a) => (a.builder!.params as { poolBarrier?: boolean }).poolBarrier === true);
    if (barriers.length === 0) {
      out.push(
        note(
          'pool-needs-barrier',
          'pool-barrier',
          pools.map((p) => p.id),
          `The pool (${list(sorted(pools.map((p) => p.assemblyId)))}) needs a barrier at least 4ft tall all the way around, with self-closing, self-latching gates; build one with build_fence and "poolBarrier": true.`,
          'IRC Appendix AG105.2 / ISPSC 305',
        ),
      );
    }
    for (const fence of barriers) {
      const parts = built.filter((p) => p.assemblyId === fence.id);
      const climbable = parts.filter((p) => has(p, 'not-pool-barrier')).map((p) => p.id);
      const partIds = new Set(parts.map((p) => p.id));
      const badGates = Object.values(project.joints)
        .filter((j) => j.partIds.some((id) => partIds.has(id)) && j.jointTypeId.startsWith('gate-'))
        .filter((j) => {
          // Judge only hardware the catalog knows; a joint type with no hardware item can't be checked.
          const hw = idx.jointTypes.get(j.jointTypeId)?.hardwareId;
          const m = hw ? idx.materials.get(hw) : undefined;
          return m !== undefined && !(m.flags?.includes('pool-gate-hardware') ?? false);
        })
        .map((j) => j.id);
      if (climbable.length > 0 || badGates.length > 0) {
        const bits = [
          climbable.length > 0 ? `${list(sorted(climbable))} ${climbable.length === 1 ? "isn't" : "aren't"} rated for a pool barrier` : '',
          badGates.length > 0 ? `gate hardware ${list(sorted(badGates))} isn't self-closing and self-latching pool hardware` : '',
        ].filter(Boolean);
        out.push(note('pool-barrier-parts', 'pool-barrier', [fence.id, ...climbable, ...badGates], `In pool barrier ${fence.id}, ${bits.join(', and ')}.`, 'IRC Appendix AG105.2'));
      }
    }
    for (const fence of fences) {
      if ((fence.builder!.params as { poolBarrier?: boolean }).poolBarrier === true) continue;
      const parts = built.filter((p) => p.assemblyId === fence.id);
      if (parts.length === 0 || Math.min(...parts.map(nearestPool)) >= FENCE_NEAR_POOL_MM) continue;
      out.push(
        note(
          'fence-not-pool-barrier',
          'pool-barrier',
          [fence.id],
          `Fence ${fence.id} is near the pool but doesn't count as a pool barrier as built (climbable rails, mesh or gaps, or ordinary gate hardware). Rebuild it with "poolBarrier": true if it's meant to be one.`,
          'IRC Appendix AG105.2',
        ),
      );
    }
  }

  // 4. Licensed trades.
  const trade = built.filter((p) => has(p, 'licensed-trade'));
  if (trade.length > 0) {
    const names = sorted(trade.map((p) => mat(p)!.name.toLowerCase()));
    out.push(
      note(
        'licensed-trade',
        'licensed-trade',
        trade.map((p) => p.id),
        `${list(names)} (${list(sorted(trade.map((p) => p.id)))}) usually ${trade.length === 1 ? 'needs' : 'need'} a licensed electrician, plumber or HVAC tech and a permit.`,
        'Local licensing and permit rules',
      ),
    );
  }

  // 5. Wet areas: paper-faced drywall next to a shower or tub.
  const byAssembly = new Map<string, Part[]>();
  for (const p of built) {
    const list2 = byAssembly.get(p.assemblyId) ?? [];
    list2.push(p);
    byAssembly.set(p.assemblyId, list2);
  }
  const wet = (p: Part) => {
    const words = [p.name ?? '', ...p.tags, mat(p)?.name ?? ''].join(' ').toLowerCase();
    return /\bshower\b|\btub\b|bathtub/.test(words);
  };
  const isDrywall = (p: Part) => {
    const m = mat(p);
    return !!m && (m.id.includes('drywall') || /drywall|gypsum/i.test(m.name));
  };
  for (const [asmId, parts] of [...byAssembly].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const dry = parts.filter((p) => has(p, 'not-for-wet-areas'));
    if (dry.length > 0 && parts.some(wet)) {
      out.push(
        note(
          'wet-area',
          'not-for-wet-areas',
          dry.map((p) => p.id),
          `${asmId} has a shower or tub next to ${list(sorted(dry.map((p) => p.id)))}, which isn't made for wet areas: use cement board with a waterproofing membrane there.`,
          'IRC R702.4.2',
        ),
      );
    }
    // 6. Foam plastic needs a thermal barrier (IRC R316.4).
    const kind = project.assemblies[asmId]?.kind;
    const foam = parts.filter((p) => has(p, 'thermal-barrier'));
    if ((kind === 'wall' || kind === 'roof') && foam.length > 0 && !parts.some(isDrywall)) {
      out.push(
        note(
          'thermal-barrier',
          'thermal-barrier',
          foam.map((p) => p.id),
          `Foam insulation ${list(sorted(foam.map((p) => p.id)))} in ${asmId} needs a thermal barrier such as 1/2in drywall on the inside if the space is occupied.`,
          'IRC R316.4',
        ),
      );
    }
    // 7. Heavy roofing.
    const heavy = parts.filter((p) => has(p, 'heavy-roofing'));
    if (kind === 'roof' && heavy.length > 0) {
      out.push(
        note(
          'heavy-roofing',
          'heavy-roofing',
          heavy.map((p) => p.id),
          `${asmId} has clay or concrete tile, which weighs about 9–12 psf; check the rafters with check_structure before you build it.`,
          'IRC R905.3, R802',
        ),
      );
    }
  }

  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
