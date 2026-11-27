import { describe, expect, it } from 'vitest';
import { findParts, getPartInfo, listMaterials, measure, searchCatalog, type QueryResult } from '../src/index.ts';
import { poolHouseBus } from './helpers.ts';

const bus = poolHouseBus();
const p = bus.project;
const c = bus.catalog;

function text(r: QueryResult): string {
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
  return r.text;
}

describe('find_parts', () => {
  it('counts and lists the studs in W1, capped by limit', () => {
    const studs = Object.values(p.parts).filter((x) => x.assemblyId === 'W1' && x.role === 'stud').length;
    expect(studs).toBe(18);
    const out = text(findParts(p, c, { assembly: 'W1', role: 'stud', limit: 5 }));
    expect(out).toMatch(/^18 parts match\./);
    expect(out).toContain('W1-S01 · stud · — · W1 · spf-no2/2x4 · 8\' 7 1/2"');
    expect(out.split('\n').filter((l) => l.startsWith('W1-S'))).toHaveLength(5);
    expect(out).toContain('…and 13 more; narrow with role or assembly.');
  });

  it('filters by tag and material, and finds parts near a point, nearest first', () => {
    expect(text(findParts(p, c, { tag: 'king' }))).toMatch(/^4 parts match/);
    expect(text(findParts(p, c, { material: 'concrete' }))).toMatch(/^5 parts match/);
    const near = text(findParts(p, c, { near: { x: '10ft', y: '4ft', z: 0 }, within: '8in' }));
    const rows = near.split('\n').slice(2);
    expect(rows[0]).toMatch(/^W1-SH\d+ .* · 0" away$/);
    expect(rows.every((r) => r.startsWith('W1-'))).toBe(true);
  });

  it('refuses an unknown assembly with a suggestion, and "within" without "near"', () => {
    const r = findParts(p, c, { assembly: 'W9' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatchObject({ code: 'not_found', path: 'assembly' });
    expect(findParts(p, c, { within: '1ft' }).ok).toBe(false);
    expect(findParts(p, c, { role: 'studd' }).ok).toBe(false);
  });
});

describe('get_part', () => {
  it('gives a stud as 103 1/2in with its joints', () => {
    const out = text(getPartInfo(p, c, { id: 'W1-S02' }));
    expect(out).toContain('Size: 8\' 7 1/2" long');
    expect(out).toContain('(2629 × 38 × 89 mm)');
    expect(out).toMatch(/Joints \(\d+\):\n- J\d{4} nailed-16d with W1-P0\d/);
  });

  it('describes an assembly from its builder recipe, in feet and inches', () => {
    const out = text(getPartInfo(p, c, { id: 'W1' }));
    expect(out).toContain('W1 "North wall" (wall) · 31 parts');
    expect(out).toContain('Made by build_wall:');
    expect(out).toContain('- height: 9\' 0"');
    expect(out).toContain('- studLength: 8\' 7 1/2"');
    expect(out).toContain('Parts by role: 3 plate, 18 stud, 10 sheathing');
    expect(out).not.toContain('frameU0');
  });

  it('suggests a close id for an unknown one', () => {
    const r = getPartInfo(p, c, { id: 'W1-S99' });
    expect(r).toEqual({
      ok: false,
      errors: [{ code: 'not_found', message: 'There\'s no part or assembly "W1-S99".', path: 'id', hint: 'Did you mean "W1-S09"?' }],
    });
  });
});

describe('measure', () => {
  it('gives the clear gap between the north and south walls: 16ft minus both wall depths', () => {
    const out = text(measure(p, c, { from: 'W1', to: 'W3' }));
    // Outside faces 16ft apart; each wall's framing is 3 1/2in deep inside its outside face.
    expect(out).toContain('Clear gap between them: 15\' 5" (4699 mm) (along z)');
    expect(out).toMatch(/dz \(south \+\): 15' 8 15\/16"/);
  });

  it('measures from a point, and reports an overlap', () => {
    const out = text(measure(p, c, { from: { x: 0, z: 0 }, to: { x: '3ft', z: '4ft' } }));
    expect(out).toContain('Centre to centre: 5\' 0" (1524 mm)');
    expect(text(measure(p, c, { from: 'W1-S02', to: 'W1' }))).toMatch(/overlap by/);
  });

  it('reads ids wrapped in quote marks inside the string the same as bare ids', () => {
    const bare = text(measure(p, c, { from: 'W1', to: 'W3' }));
    expect(text(measure(p, c, { from: '"W1"', to: ' “W3” ' }))).toBe(bare);
    expect(text(getPartInfo(p, c, { id: '"W1-S02"' }))).toBe(text(getPartInfo(p, c, { id: 'W1-S02' })));
    expect(text(findParts(p, c, { assembly: '"W1"', limit: 3 }))).toBe(text(findParts(p, c, { assembly: 'W1', limit: 3 })));
  });

  it('refuses unknown ids', () => {
    const r = measure(p, c, { from: 'W1', to: 'W7' });
    expect(!r.ok && r.errors.map((e) => e.path)).toEqual(['to']);
  });
});

describe('list_materials', () => {
  it('counts studs and linear feet, sheets, slab concrete and fasteners', () => {
    const out = text(listMaterials(p, c, { assembly: 'W1' }));
    expect(out).toContain('SPF No.2 lumber 2x4: ');
    expect(out).toMatch(/7\/16in OSB sheathing: 10 pieces, \d+ ft², about \d+ 4×8 sheets/);
    expect(out).toContain('16d common nail: ');
    expect(out).toContain('Quantities only; prices come later.');
  });

  it('gives the slab volume in cubic yards', () => {
    const out = text(listMaterials(p, c, { assembly: 'FD1' }));
    // Slab 20 × 16 ft × 4in = 106.67 ft³ plus four 12 × 12in thickened edges (20+20+14+14 ft) = 174.67 ft³ ≈ 6.47 yd³.
    expect(out).toContain('3000 psi concrete: 5 pieces, 6.47 yd³');
    expect(out).not.toMatch(/cast in place/i);
  });

  it('refuses an unknown assembly', () => {
    expect(listMaterials(p, c, { assembly: 'Q1' }).ok).toBe(false);
  });

  it('never changes the project', () => {
    expect(bus.project).toBe(p);
  });
});

describe('search_catalog', () => {
  it('matches every word in the id, name or description, with a count and flags', () => {
    const out = text(searchCatalog(p, c, { text: 'pool fence' }));
    expect(out).toMatch(/^\d+ materials? match/);
    expect(out).toContain('glass-pool-fence-panel · ');
    expect(out).toMatch(/glass-pool-fence-panel · .* · fencing · .*safety-glazing/);
  });

  it('filters by category and flag, and clips descriptions', () => {
    const out = text(searchCatalog(p, c, { category: 'fencing', flag: 'pool-barrier' }));
    const rows = out.split('\n').filter((l) => l.startsWith('- '));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.includes(' · fencing · ') && r.includes('pool-barrier'))).toBe(true);
    for (const l of out.split('\n').filter((x) => x.startsWith('  '))) expect(l.length).toBeLessThanOrEqual(102);
  });

  it('caps the list, says how many more, and handles no match and bad input', () => {
    const out = text(searchCatalog(p, c, { category: 'plumbing', limit: 3 }));
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
    expect(out).toMatch(/…and \d+ more; narrow the search or raise "limit"\./);
    expect(text(searchCatalog(p, c, { text: 'unobtainium' }))).toContain('No materials match');
    expect(searchCatalog(p, c, { category: 'kryptonite' }).ok).toBe(false);
    // Site context isn't something to build with.
    expect(text(searchCatalog(p, c, { text: 'site context' }))).toContain('No materials match');
  });
});
