/**
 * Acceptance: a 16 × 20 pool-house shell through the CommandBus, in one group (one
 * Claude turn): slab, four 9ft walls clockwise, a sliding door and a window, and a
 * 6 in 12 gable roof.
 */
import { describe, expect, it } from 'vitest';
import { createProject, findAllClashes, formatErrors, type CommandBus, type Project } from '../../src/index.ts';
import { makeBus, model } from '../helpers.ts';

const IN = 25.4;

function exec(bus: CommandBus, name: string, input: unknown) {
  const res = bus.execute(name, input);
  if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
  return res;
}

function buildShell() {
  const bus = makeBus(createProject({ name: 'Pool house' }));
  bus.group({ label: 'Build the pool house shell', source: 'claude', turnId: 't1' }, () => {
    exec(bus, 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } });
    exec(bus, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' });
    exec(bus, 'build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' });
    exec(bus, 'build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' });
    exec(bus, 'build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' });
    exec(bus, 'add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' });
    exec(bus, 'add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' });
    exec(bus, 'build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' });
  });
  return bus;
}

const inAsm = (p: Project, id: string) => Object.values(p.parts).filter((x) => x.assemblyId === id);
const studs = (p: Project, wall: string, tag: string) => inAsm(p, wall).filter((x) => x.role === 'stud' && x.tags.includes(tag)).length;

describe('acceptance: 16 × 20 shell, 9ft walls, sliding door + window, 6/12 gable', () => {
  const bus = buildShell();
  const p = bus.project;

  it('stud counts per wall', () => {
    // W1 north (built first, through at both ends): 20ft, commons at 16 … 224in = 14, plus 2 ends.
    // W2 east (butts W1 at its start, framing from 3 1/2in): 16ft, commons at 16 … 176in = 11.
    //   Window RO 78–114in (centre 96in) with 1 jack + 1 king a side: framing 75–117in, so the
    //   commons at 80, 96 and 112in go → 8 left. Cripples on layout at 80, 96, 112 above the
    //   header and the same three under the sill → 6.
    // W3 south (butts W2): 20ft, commons 14. Sliding door RO 84–156in with 2 jacks + 2 kings a
    //   side: framing 78–162in, so commons at 80 … 160in (6) go → 8 left. Cripples above the
    //   header on layout between the outer jacks (81–159in): 96, 112, 128, 144 → 4.
    // W4 west (butts W3 and W1, framing 3 1/2in–188 1/2in): commons 16 … 176in = 11.
    const expected = {
      W1: { common: 14, end: 2, king: 0, jack: 0, cripple: 0, 'corner-backer': 2 },
      W2: { common: 8, end: 2, king: 2, jack: 2, cripple: 6, 'corner-backer': 1 },
      W3: { common: 8, end: 2, king: 4, jack: 4, cripple: 4, 'corner-backer': 1 },
      W4: { common: 11, end: 2, king: 0, jack: 0, cripple: 0, 'corner-backer': 0 },
    };
    for (const [wall, tags] of Object.entries(expected)) {
      for (const [tag, n] of Object.entries(tags)) expect(studs(p, wall, tag), `${wall} ${tag}`).toBe(n);
    }
  });

  it('every full-height stud is 103 1/2in', () => {
    for (const s of Object.values(p.parts).filter((x) => x.role === 'stud' && /common|end|king|corner-backer/.test(x.tags.join()))) {
      expect(s.size.length).toBeCloseTo(103.5 * IN, 6);
    }
  });

  it('header sizes: 16ft building width → 24ft column of IRC Table R602.7(1), 30 psf default', () => {
    const header = (wall: string) => inAsm(p, wall).filter((x) => x.role === 'header');
    // Sliding door, 72in: 2-2x8 spans only 5' 9", so 2-2x10 (6' 10", NJ 2); 72 + 4 × 1 1/2 = 78in long.
    expect(header('W3')).toHaveLength(2);
    expect(header('W3').every((h) => h.sectionId === '2x10' && Math.abs(h.size.length - 78 * IN) < 1e-6)).toBe(true);
    // Window, 36in: 2-2x4 spans 3' 1" (NJ 1); 36 + 2 × 1 1/2 = 39in long.
    expect(header('W2')).toHaveLength(2);
    expect(header('W2').every((h) => h.sectionId === '2x4' && Math.abs(h.size.length - 39 * IN) < 1e-6)).toBe(true);
    expect(p.assemblies.O1!.builder!.params).toMatchObject({ jacks: 2, kings: 2, header: { plies: 2, sectionId: '2x10' } });
    expect(p.assemblies.O2!.builder!.params).toMatchObject({ jacks: 1, kings: 1, header: { plies: 2, sectionId: '2x4' } });
  });

  it('the roof: one ridge, 16 rafter pairs, one tie per pair', () => {
    expect(inAsm(p, 'R1').filter((x) => x.role === 'ridge')).toHaveLength(1);
    // Along 20ft at 16in: ends at 0 and 238 1/2in, commons 16 … 224in (14) → 16 pairs.
    expect(inAsm(p, 'R1').filter((x) => x.role === 'rafter')).toHaveLength(32);
    expect(inAsm(p, 'R1').filter((x) => x.tags.includes('rafter-tie'))).toHaveLength(16);
  });

  it('every non-site part has a joint and a build phase consistent with its assembly', () => {
    const joined = new Set(Object.values(p.joints).flatMap((j) => j.partIds));
    const phases: Record<string, string[]> = {
      foundation: ['foundation'],
      wall: ['framing', 'sheathing'],
      roof: ['roofing'],
    };
    for (const part of Object.values(p.parts)) {
      if (part.tags.includes('site-context')) continue;
      expect(joined.has(part.id), part.id).toBe(true);
      expect(phases[p.assemblies[part.assemblyId]!.kind], part.id).toContain(part.buildStep.phase);
    }
  });

  it('nothing runs through anything', () => {
    expect(findAllClashes(p)).toEqual([]);
  });

  it('one undo returns to the empty project; redo restores it exactly', () => {
    expect(bus.listHistory()).toHaveLength(1);
    expect(bus.undo().ok).toBe(true);
    expect(model(bus.project)).toEqual(model(createProject({ name: 'Pool house' })));
    expect(bus.redo().ok).toBe(true);
    expect(bus.project).toEqual(p);
  });
});

describe('acceptance: impossible inputs are refused in plain sentences', () => {
  const bus = buildShell();
  exec(bus, 'place_structure', { kind: 'house', at: { x: '30ft', z: 0 }, width: '30ft', depth: '20ft' });
  const cases: Array<[string, string, unknown, RegExp, boolean]> = [
    ['oversized opening', 'add_opening', { wallId: 'W1', kind: 'sliding-door', at: '2ft', width: '15ft' }, /opening is longer than any built-up 2x header/, true],
    ['30ft rafters', 'build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '60ft', z: '50ft' }, pitch: '6 in 12', bearingHeight: '9ft' }, /rafters, past the 20' 0" stock length/, true],
    ['wall into the neighbour structure', 'build_wall', { start: { x: '25ft', z: '5ft' }, end: { x: '40ft', z: '5ft' }, height: '8ft' }, /would run through X1 "Existing house"/, false],
    ['unknown wall', 'add_opening', { wallId: 'W7', kind: 'door', at: '3ft' }, /^There's no wall "W7"\.$/, false],
    ['flat pitch', 'build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '0 in 12' }, /pitch must be between 1 in 12 and 24 in 12/, false],
  ];
  it.each(cases)('%s', (_label, name, input, pattern, mentionsLength) => {
    const before = bus.project;
    const res = bus.execute(name, input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const e = res.errors[0]!;
    expect(e.message).toMatch(pattern);
    // One readable sentence: no Zod jargon, ends with a full stop.
    expect(e.message).not.toMatch(/zod|ZodError|invalid_type|Expected|received/i);
    expect(e.message).toMatch(/[.!?]$/);
    // Lengths are written in feet and inches.
    if (mentionsLength) expect(e.message).toMatch(/\d+' \d+(?: \d+\/\d+)?"/);
    expect(bus.project).toBe(before);
  });

  it('the oversized opening names the width and the largest header in feet and inches', () => {
    const res = bus.execute('add_opening', { wallId: 'W1', kind: 'sliding-door', at: '2ft', width: '15ft' });
    expect(res.ok ? '' : res.errors[0]!.message).toBe(
      `A 15' 0" opening is longer than any built-up 2x header allows here (2-2x12 max 8' 1" at 30 psf). Use a narrower opening or an engineered beam.`,
    );
    expect(res.ok ? undefined : res.errors[0]!.path).toBe('width');
  });
});

