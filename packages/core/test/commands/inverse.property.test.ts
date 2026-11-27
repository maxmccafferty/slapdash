import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../src/index.ts';
import { applyInverse, makeBus, model, run } from '../helpers.ts';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Gen = (p: Project, r: () => number) => { name: string; input: unknown } | null;

const pick = <T>(xs: readonly T[], r: () => number): T | undefined => xs[Math.floor(r() * xs.length)];
const len = (r: () => number) => pick(['8ft', '92 5/8in', 2400, '10ft 6in', '3.5m'], r)!;
const pt = (r: () => number) => ({ x: Math.round(r() * 5000), y: Math.round(r() * 3000), z: `${Math.round(r() * 20)}ft` });

const generators: Gen[] = [
  (_p, r) => ({ name: 'add_assembly', input: { name: `A${Math.floor(r() * 100)}`, kind: pick(['wall', 'floor', 'roof'], r) } }),
  (p, r) => {
    const a = pick(Object.keys(p.assemblies), r);
    if (!a) return null;
    const cuts =
      r() < 0.3
        ? {
            cuts: {
              start: { slope: 26.565, name: 'plumb' },
              end: { slope: -26.565, name: 'plumb' },
              ...(r() < 0.5 ? { notches: [{ kind: 'birdsmouth', profile: [{ x: '1ft', z: -1 }, { x: '1ft', z: '1in' }, { x: '1ft 2in', z: -1 }] }] } : {}),
            },
          }
        : {};
    return r() < 0.7
      ? { name: 'add_part', input: { assemblyId: a, role: pick(['stud', 'plate', 'joist'], r), materialId: 'spf-no2', sectionId: pick(['2x4', '2x6'], r), position: pt(r), length: len(r), ...cuts } }
      : { name: 'add_part', input: { assemblyId: a, role: 'sheathing', materialId: 'plywood-cdx', position: pt(r), length: '8ft', width: '4ft', height: '1/2in' } };
  },
  (p, r) => {
    const lumber = Object.values(p.parts).filter((x) => x.materialId === 'spf-no2').map((x) => x.id);
    const a = pick(lumber, r);
    const b = r() < 0.3 ? 'GROUND' : pick(lumber, r);
    if (!a || !b) return null;
    return { name: 'connect', input: { jointTypeId: b === 'GROUND' ? 'post-base' : 'nailed-16d', partIds: [a, b], at: pt(r) } };
  },
  (p, r) => {
    const ids = Object.keys(p.parts);
    const a = pick(ids, r);
    if (!a) return null;
    return { name: 'move_parts', input: { ids: [...new Set([a, pick(ids, r)!])], by: { x: '1ft', y: 0, z: -100 } } };
  },
  (p, r) => {
    const a = pick(Object.keys(p.parts), r);
    return a ? { name: 'resize_part', input: { id: a, length: len(r) } } : null;
  },
  (p, r) => {
    const part = pick(Object.values(p.parts), r);
    if (!part) return null;
    if (part.sectionId && r() < 0.3) {
      return { name: 'update_part', input: { id: part.id, cuts: part.cuts ? null : { end: { slope: -45, name: 'plumb' } } } };
    }
    return part.sectionId
      ? { name: 'update_part', input: { id: part.id, sectionId: pick(['2x4', '2x6'], r), tags: ['t'] } }
      : { name: 'update_part', input: { id: part.id, name: 'renamed' } };
  },
  (p, r) => {
    const a = pick(Object.keys(p.parts), r);
    return a ? { name: 'delete_parts', input: { ids: [a] } } : null;
  },
  (p, r) => {
    const j = pick(Object.keys(p.joints), r);
    return j ? { name: 'update_joint', input: { id: j, fastenerCount: 1 + Math.floor(r() * 5), note: 'n' } } : null;
  },
  (p, r) => {
    const j = pick(Object.keys(p.joints), r);
    return j ? { name: 'disconnect', input: { ids: [j] } } : null;
  },
  (p, r) => {
    const a = pick(Object.keys(p.assemblies), r);
    return a ? { name: 'delete_assembly', input: { id: a, withParts: true } } : null;
  },
  (p, r) => {
    const a = pick(Object.keys(p.assemblies), r);
    return a ? { name: 'update_assembly', input: { id: a, name: `renamed ${Math.floor(r() * 10)}` } } : null;
  },
  (_p, r) => ({ name: 'set_design_load', input: { key: 'groundSnow', value: `${10 + Math.floor(r() * 40)} psf`, source: 'user' } }),
  (_p, r) => ({ name: 'set_site_location', input: { location: r() < 0.8 ? { label: 'Somewhere, ST' } : null } }),
  (_p, r) => ({ name: 'rename_project', input: { name: `P${Math.floor(r() * 100)}` } }),
  // Builders (indices 14–17). Refusals (clashes, odd corners) are fine: failed commands are skipped.
  (_p, r) => ({
    name: 'pour_slab',
    input: { from: { x: `${Math.floor(r() * 60)}ft`, z: `${Math.floor(r() * 60)}ft` }, to: { x: `${70 + Math.floor(r() * 20)}ft`, z: `${70 + Math.floor(r() * 20)}ft` } },
  }),
  (_p, r) => {
    const x = Math.round(r() * 30000) - 15000;
    const z = Math.round(r() * 30000) - 15000;
    const angle = pick([0, 90, 180, 270, 30, 45], r)! * (Math.PI / 180);
    const len = 3000 + Math.round(r() * 5000);
    return {
      name: 'build_wall',
      input: {
        start: { x, z },
        end: { x: Math.round(x + len * Math.cos(angle)), z: Math.round(z + len * Math.sin(angle)) },
        height: pick(['8ft', '9ft', '10ft'], r),
        spacing: pick(['16in', '24in'], r),
        bracing: pick(['sheathing', 'sheathing', 'let-in'], r),
      },
    };
  },
  (p, r) => {
    const walls = Object.values(p.assemblies).filter((a) => a.builder?.name === 'build_wall');
    const w = pick(walls, r);
    if (!w) return null;
    const length = (w.builder!.params as { length: number }).length;
    return { name: 'add_opening', input: { wallId: w.id, kind: pick(['window', 'door', 'sliding-door'], r), centerAt: Math.round(length * (0.3 + r() * 0.4)) } };
  },
  (_p, r) => ({
    name: 'place_structure',
    input: { kind: pick(['house', 'pool', 'tree', 'shed', 'box'], r), at: { x: `${-80 + Math.floor(r() * 40)}ft`, z: `${Math.floor(r() * 80)}ft` }, rotation: Math.round(r() * 90) },
  }),
  // Prices (indices 18–19).
  (_p, r) => ({
    name: 'set_price',
    input: r() < 0.5
      ? { material: 'spf-no2', size: pick(['2x4', '2x6'], r), price: 0.3 + Math.floor(r() * 50) / 100, per: 'linear-ft' }
      : { material: 'spf-no2', price: 3 + Math.floor(r() * 10), per: 'each', length: '8ft' },
  }),
  (p, r) => {
    const key = pick(Object.keys(p.prices ?? {}), r);
    if (!key) return null;
    const [material, size] = key.split('|');
    return { name: 'clear_price', input: size === undefined ? { material } : { material, size } };
  },
  // Tier 2/3 builders (indices 20–22), out east of everything else so they rarely clash.
  (_p, r) => {
    const x = 120 + Math.floor(r() * 200);
    const z = Math.floor(r() * 200);
    return {
      name: 'build_fence',
      input: {
        path: [{ x: `${x}ft`, z: `${z}ft` }, { x: `${x + 16}ft`, z: `${z}ft` }, { x: `${x + 16}ft`, z: `${z + 10}ft` }],
        style: pick(['privacy', 'picket', 'chain-link', 'aluminum', 'glass'], r),
        height: '4ft',
        ...(r() < 0.5 ? { gates: [{ centerAt: '8ft' }] } : {}),
      },
    };
  },
  (_p, r) => {
    const x = 120 + Math.floor(r() * 200);
    const z = -60 - Math.floor(r() * 200);
    return { name: 'build_pergola', input: { from: { x: `${x}ft`, z: `${z}ft` }, to: { x: `${x + 12}ft`, z: `${z + 10}ft` }, roofing: pick(['none', 'polycarbonate'], r) } };
  },
  (_p, r) => {
    const x = -120 - Math.floor(r() * 200);
    const z = -60 - Math.floor(r() * 200);
    return {
      name: 'build_deck',
      input: { from: { x: `${x}ft`, z: `${z}ft` }, to: { x: `${x + 12}ft`, z: `${z + 10}ft` }, height: pick(['2ft', '4ft'], r), ...(r() < 0.5 ? { stairs: { side: 'south', at: '3ft' } } : {}) },
    };
  },
];

// Weight the generators towards building things so the model grows.
const weighted = [0, 1, 1, 1, 1, 2, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 17, 18, 19, 20, 21, 22].map((i) => generators[i]!);

const builtAnySeed = new Set<string>();

describe.each([1, 2, 3, 42, 2026])('inverse property (seed %i)', (seed) => {
  // Each seed runs a long random command sequence and checks every inverse, which
  // takes about 3 s on the full stack and can pass vitest's 5 s default when every
  // package runs in parallel (as in CI). 30 s leaves plenty of headroom.
  it('every recorded inverse restores the previous state; full undo/redo round-trips', { timeout: 30_000 }, () => {
    const r = rng(seed);
    const bus = makeBus();
    let project = createProject({ name: 'Test' });
    const states: Project[] = [project];
    let applied = 0;
    const built = new Set<string>();

    for (let step = 0; step < 250; step++) {
      const cmd = pick(weighted, r)!(project, r);
      if (!cmd) continue;
      const res = run(project, cmd);
      if (!res.ok) continue; // e.g. a duplicate joint: refused, which is fine
      expect(model(applyInverse(res.project, res.inverse))).toEqual(model(project));
      const viaBus = bus.execute(cmd.name, cmd.input);
      expect(viaBus.ok).toBe(true);
      expect(bus.project).toEqual(res.project);
      project = res.project;
      states.push(project);
      applied++;
      if (res.redo.name === 'patch_entities') {
        built.add(cmd.name);
        builtAnySeed.add(cmd.name);
      }
    }
    expect(applied).toBeGreaterThan(50);
    // Builders run (and round-trip) on every seed, not just get refused.
    expect(built.has('build_wall')).toBe(true);
    expect(built.has('place_structure')).toBe(true);

    const final = bus.project;
    while (bus.canUndo) expect(bus.undo().ok).toBe(true);
    expect(model(bus.project)).toEqual(model(states[0]!));
    while (bus.canRedo) expect(bus.redo().ok).toBe(true);
    expect(bus.project).toEqual(final);
  });
});

describe('builder coverage across seeds', () => {
  it('every builder generator succeeded at least once', () => {
    for (const name of ['pour_slab', 'build_wall', 'add_opening', 'place_structure', 'build_fence', 'build_pergola', 'build_deck']) expect(builtAnySeed, name).toContain(name);
  });
});
