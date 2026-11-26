/**
 * Readable, stable IDs (ADR-0002 §F7). Claude, snapshot labels and the user all
 * share them, so they are short and meaningful:
 *
 * - assemblies: `<KindCode><n>`, e.g. `W2` (the second wall)
 * - parts: `<assemblyId>-<RoleCode><nn>`, e.g. `W2-S07` (the seventh stud in W2)
 * - joints: `J<nnnn>`, e.g. `J0012`
 *
 * Numbers come from per-project counters and are never reused after a delete, so an
 * ID Claude saw earlier can't come to mean a different part. A part keeps its ID
 * even if its role or assembly later changes.
 */
export const ASSEMBLY_KINDS = ['foundation', 'floor', 'wall', 'roof', 'opening', 'structure', 'site', 'misc'] as const;
export type AssemblyKind = (typeof ASSEMBLY_KINDS)[number];

export const KIND_CODES: Record<AssemblyKind, string> = {
  foundation: 'FD',
  floor: 'F',
  wall: 'W',
  roof: 'R',
  opening: 'O',
  structure: 'X',
  site: 'ST',
  misc: 'M',
};

export const PART_ROLES = [
  'stud',
  'plate',
  'header',
  'sill',
  'joist',
  'rim',
  'rafter',
  'ridge',
  'beam',
  'post',
  'blocking',
  'sheathing',
  'slab',
  'footing',
  'pier',
  'panel',
  'trim',
  'brace',
  'rail',
  'other',
] as const;
export type PartRole = (typeof PART_ROLES)[number];

export const ROLE_CODES: Record<PartRole, string> = {
  stud: 'S',
  plate: 'P',
  header: 'H',
  sill: 'SL',
  joist: 'J',
  rim: 'RJ',
  rafter: 'R',
  ridge: 'RG',
  beam: 'B',
  post: 'PT',
  blocking: 'BK',
  sheathing: 'SH',
  slab: 'SB',
  footing: 'FT',
  pier: 'PR',
  panel: 'PN',
  trim: 'TR',
  brace: 'BR',
  rail: 'RL',
  other: 'X',
};

export const ASSEMBLY_ID = /^[A-Z]{1,2}\d{1,3}$/;
export const PART_ID = /^[A-Z]{1,2}\d{1,3}-[A-Z]{1,2}\d{2,4}$/;
export const JOINT_ID = /^J\d{4,}$/;

/** The other end of a joint that sits on the ground (a footing, a post set in soil). */
export const GROUND = 'GROUND';

export interface IdCounters {
  /** Last number used per assembly prefix, e.g. { W: 2 }. */
  assemblies: Record<string, number>;
  /** Last number used per `<assemblyId>-<RoleCode>`, e.g. { "W2-S": 7 }. */
  parts: Record<string, number>;
  /** Last joint number used. */
  joints: number;
}

export interface Allocated<C> {
  id: string;
  counters: C;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function nextFree(
  last: number,
  format: (n: number) => string,
  taken: (id: string) => boolean,
): { id: string; n: number } {
  let n = last + 1;
  while (taken(format(n))) n++;
  return { id: format(n), n };
}

export function nextAssemblyId(
  counters: IdCounters,
  kind: AssemblyKind,
  taken: (id: string) => boolean = () => false,
): Allocated<IdCounters> {
  const prefix = KIND_CODES[kind];
  const { id, n } = nextFree(counters.assemblies[prefix] ?? 0, (k) => `${prefix}${k}`, taken);
  return { id, counters: { ...counters, assemblies: { ...counters.assemblies, [prefix]: n } } };
}

export function nextPartId(
  counters: IdCounters,
  assemblyId: string,
  role: PartRole,
  taken: (id: string) => boolean = () => false,
): Allocated<IdCounters> {
  const key = `${assemblyId}-${ROLE_CODES[role]}`;
  const { id, n } = nextFree(counters.parts[key] ?? 0, (k) => `${key}${pad(k, 2)}`, taken);
  return { id, counters: { ...counters, parts: { ...counters.parts, [key]: n } } };
}

export function nextJointId(
  counters: IdCounters,
  taken: (id: string) => boolean = () => false,
): Allocated<IdCounters> {
  const { id, n } = nextFree(counters.joints, (k) => `J${pad(k, 4)}`, taken);
  return { id, counters: { ...counters, joints: n } };
}

/** Split an ID into its counter key and number: `W2-S07` → { key: "W2-S", n: 7 }. */
function splitId(id: string): { key: string; n: number } | null {
  const m = /^(.*?)(\d+)$/.exec(id);
  return m ? { key: m[1]!, n: Number(m[2]) } : null;
}

/**
 * Record an explicitly chosen ID so the counters never hand it out again.
 * Counters only move forward.
 */
export function reserveId(counters: IdCounters, kind: 'assembly' | 'part' | 'joint', id: string): IdCounters {
  const split = splitId(id);
  if (!split) return counters;
  if (kind === 'joint') {
    return split.n > counters.joints ? { ...counters, joints: split.n } : counters;
  }
  const table = kind === 'assembly' ? 'assemblies' : 'parts';
  const current = counters[table][split.key] ?? 0;
  if (split.n <= current) return counters;
  return { ...counters, [table]: { ...counters[table], [split.key]: split.n } };
}

/** Per-key maximum of two counter sets; used when a whole project is replaced. */
export function mergeCounters(a: IdCounters, b: IdCounters): IdCounters {
  const maxRecord = (x: Record<string, number>, y: Record<string, number>) => {
    const out: Record<string, number> = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  return {
    assemblies: maxRecord(a.assemblies, b.assemblies),
    parts: maxRecord(a.parts, b.parts),
    joints: Math.max(a.joints, b.joints),
  };
}
