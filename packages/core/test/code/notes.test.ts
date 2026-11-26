import { describe, expect, it } from 'vitest';
import { SAMPLE_CATALOG, codeNotes, createProject, indexCatalog, type Catalog, type Material, type Project } from '../../src/index.ts';
import { run } from '../helpers.ts';

const extra: Material[] = [
  { id: 'opening-unit', name: 'Window or door unit (generic)', category: 'opening', acceptsJoints: ['nailed-16d'] },
  { id: 'receptacle-15a', name: '15 A receptacle', category: 'electrical', acceptsJoints: [], flags: ['receptacle-needs-gfci'], density_kg_m3: 500 },
  { id: 'receptacle-gfci-20a', name: '20 A GFCI receptacle', category: 'electrical', acceptsJoints: [], flags: ['gfci'], density_kg_m3: 500 },
  { id: 'subpanel-100a', name: '100 A subpanel', category: 'electrical', acceptsJoints: [], flags: ['licensed-trade'], density_kg_m3: 500 },
  { id: 'drywall-gypsum', name: 'Drywall (gypsum board)', category: 'sheet', acceptsJoints: [], flags: ['not-for-wet-areas'], density_kg_m3: 700 },
  { id: 'cement-board', name: 'Cement board', category: 'finish', acceptsJoints: [], flags: ['wet-area-rated'], density_kg_m3: 1200 },
  { id: 'outdoor-shower', name: 'Outdoor shower', category: 'plumbing', acceptsJoints: [], density_kg_m3: 300 },
  { id: 'rigid-xps', name: 'Rigid foam, XPS', category: 'insulation', acceptsJoints: [], flags: ['thermal-barrier'], density_kg_m3: 23 },
  { id: 'tile-roof-clay', name: 'Clay roof tile', category: 'roofing', acceptsJoints: [], flags: ['heavy-roofing'], arealMass_kg_m2: 50 },
];
const catalog: Catalog = { ...SAMPLE_CATALOG, materials: [...SAMPLE_CATALOG.materials.filter((m) => !extra.some((e) => e.id === m.id)), ...extra] };
const idx = indexCatalog(catalog);

const ok = (p: Project, name: string, input: unknown): Project => {
  const res = run(p, { name, input }, { catalog: idx });
  if (!res.ok) throw new Error(`${name}: ${res.errors.map((e) => e.message).join(' | ')}`);
  return res.project;
};
const withPool = () => ok(createProject({ name: 't' }), 'place_structure', { kind: 'pool', at: { x: '10ft', z: '10ft' }, width: '12ft', depth: '20ft' });
/** A misc assembly with one box part of `materialId` at plan (x, z) ft, `y` ft up. */
function box(p: Project, materialId: string, x: number, z: number, opts: { y?: number; kind?: string; name?: string; tags?: string[] } = {}): Project {
  let q = p;
  let asm = Object.values(q.assemblies).find((a) => a.name === (opts.name ?? 'Things'));
  if (!asm) {
    q = ok(q, 'add_assembly', { kind: opts.kind ?? 'misc', name: opts.name ?? 'Things' });
    asm = Object.values(q.assemblies).find((a) => a.name === (opts.name ?? 'Things'))!;
  }
  return ok(q, 'add_part', {
    assemblyId: asm.id,
    role: 'other',
    materialId,
    position: { x: `${x}ft`, y: `${opts.y ?? 1}ft`, z: `${z}ft` },
    length: '6in',
    width: '4in',
    height: '2in',
    ...(opts.tags ? { tags: opts.tags } : {}),
  });
}
const keys = (p: Project) => codeNotes(p, idx).map((n) => n.key.split(':')[0]);

describe('code notes', () => {
  it('a project without a pool or flagged parts has none', () => {
    expect(codeNotes(createProject({ name: 't' }), idx)).toEqual([]);
  });

  it('a pool with no barrier gets a barrier reminder; a pool barrier fence clears it', () => {
    const p = withPool();
    expect(keys(p)).toEqual(['pool-needs-barrier']);
    const n = codeNotes(p, idx)[0]!;
    expect(n.text).toMatch(/^Reminder \(not a code check\):.*Check with your building department\.$/);
    expect(n.source).toContain('AG105');
    const fenced = ok(p, 'build_fence', {
      path: [{ x: '6ft', z: '6ft' }, { x: '26ft', z: '6ft' }, { x: '26ft', z: '34ft' }, { x: '6ft', z: '34ft' }, { x: '6ft', z: '6ft' }],
      style: 'aluminum',
      height: '4ft',
      poolBarrier: true,
      gates: [{ centerAt: '10ft' }],
    });
    expect(keys(fenced)).toEqual([]);
  });

  it('a non-barrier fence near the pool is flagged; a far one is not', () => {
    const p = withPool();
    const near = ok(p, 'build_fence', { path: [{ x: '6ft', z: '6ft' }, { x: '26ft', z: '6ft' }] });
    expect(keys(near)).toContain('fence-not-pool-barrier');
    const far = ok(p, 'build_fence', { path: [{ x: '80ft', z: '6ft' }, { x: '100ft', z: '6ft' }] });
    expect(keys(far)).not.toContain('fence-not-pool-barrier');
  });

  it('a generic window near the pool and low needs safety glazing; tagged or far or high is fine', () => {
    const p = withPool();
    expect(keys(box(p, 'opening-unit', 6, 15))).toContain('safety-glazing-near-pool');
    expect(keys(box(p, 'opening-unit', 6, 15, { tags: ['safety-glazing'] }))).not.toContain('safety-glazing-near-pool');
    expect(keys(box(p, 'opening-unit', 40, 15))).not.toContain('safety-glazing-near-pool');
    expect(keys(box(p, 'opening-unit', 6, 15, { y: 6 }))).not.toContain('safety-glazing-near-pool');
    expect(keys(box(p, 'window-casement', 6, 15))).toContain('safety-glazing-near-pool');
    expect(keys(box(p, 'door-french', 6, 15))).not.toContain('safety-glazing-near-pool');
  });

  it('receptacles: none within 6ft of the pool, GFCI within 20ft or outdoors', () => {
    const p = withPool();
    expect(keys(box(p, 'receptacle-gfci-20a', 8, 15))).toContain('receptacle-near-pool');
    expect(keys(box(p, 'receptacle-15a', 0, 15))).toContain('receptacle-needs-gfci');
    expect(keys(box(p, 'receptacle-gfci-20a', 0, 15))).not.toContain('receptacle-needs-gfci');
    const indoors = box(createProject({ name: 't' }), 'receptacle-15a', 0, 0, { kind: 'wall', name: 'Wall' });
    expect(keys(indoors)).toEqual([]);
    expect(keys(box(createProject({ name: 't' }), 'receptacle-15a', 0, 0))).toEqual(['receptacle-needs-gfci']);
  });

  it('licensed trades, wet areas, thermal barriers and heavy roofing', () => {
    expect(keys(box(createProject({ name: 't' }), 'subpanel-100a', 0, 0))).toEqual(['licensed-trade']);
    const bath = box(box(createProject({ name: 't' }), 'drywall-gypsum', 0, 0, { name: 'Bath' }), 'outdoor-shower', 2, 0, { name: 'Bath' });
    expect(keys(bath)).toEqual(['wet-area']);
    expect(keys(box(box(createProject({ name: 't' }), 'cement-board', 0, 0, { name: 'Bath' }), 'outdoor-shower', 2, 0, { name: 'Bath' }))).toEqual([]);
    const foam = box(createProject({ name: 't' }), 'rigid-xps', 0, 0, { kind: 'wall', name: 'W' });
    expect(keys(foam)).toEqual(['thermal-barrier']);
    expect(keys(box(foam, 'drywall-gypsum', 2, 0, { kind: 'wall', name: 'W' }))).toEqual([]);
    expect(keys(box(createProject({ name: 't' }), 'tile-roof-clay', 0, 0, { kind: 'roof', name: 'R' }))).toEqual(['heavy-roofing']);
    expect(keys(box(createProject({ name: 't' }), 'tile-roof-clay', 0, 0))).toEqual([]);
  });

  it('is deterministic and sorted by key', () => {
    let p = withPool();
    p = box(p, 'receptacle-15a', 0, 15);
    p = box(p, 'opening-unit', 6, 15);
    p = box(p, 'subpanel-100a', 50, 50);
    const a = codeNotes(p, idx);
    expect(codeNotes(p, idx)).toEqual(a);
    expect(a.map((n) => n.key)).toEqual([...a.map((n) => n.key)].sort());
    expect(a.length).toBe(4);
  });
});
