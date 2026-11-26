import { describe, expect, it } from 'vitest';
import { createProject, migrateProject, type Project } from '../../src/index.ts';
import { expectRoundTrip, makeBus, runErr, runOk } from '../helpers.ts';

const empty = () => createProject({ name: 't' });

describe('set_price', () => {
  it('stores a per-size price that undo removes and redo restores', () => {
    const res = expectRoundTrip(empty(), 'set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' });
    expect(res.project.prices).toEqual({
      'spf-no2|2x4': { materialId: 'spf-no2', variant: '2x4', usd: 0.5, per: 'linear-ft', source: 'user' },
    });
    expect(res.summary).toBe('Set SPF No.2 lumber 2x4 to $0.50 per linear foot for this project, in place of the price table.');
  });

  it('a price for every size, per board with its length, and a note', () => {
    const res = expectRoundTrip(empty(), 'set_price', { material: 'spf-no2', price: 6.98, per: 'each', length: '8ft', note: 'yard quote' });
    expect(res.project.prices!['spf-no2']).toEqual({
      materialId: 'spf-no2',
      usd: 6.98,
      per: 'each',
      length_mm: expect.closeTo(2438.4, 6),
      note: 'yard quote',
      source: 'user',
    });
    expect(res.summary).toContain("$6.98 each (8' 0\" board)");
  });

  it('reads sizes the way people write them', () => {
    expect(runOk(empty(), 'set_price', { material: 'spf-no2', size: '2×6', price: 1, per: 'linear-ft' }).project.prices).toHaveProperty(['spf-no2|2x6']);
    expect(runOk(empty(), 'set_price', { material: 'plywood-cdx', size: '23/32', price: 40, per: 'sheet' }).project.prices).toHaveProperty([
      'plywood-cdx|23/32in',
    ]);
    expect(runOk(empty(), 'set_price', { material: 'osb-7-16', size: '7/16"', price: 12, per: 'sheet' }).project.prices).toHaveProperty([
      'osb-7-16|7/16in',
    ]);
  });

  it('replaces an earlier price for the same material and size', () => {
    let p = runOk(empty(), 'set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' }).project;
    p = expectRoundTrip(p, 'set_price', { material: 'spf-no2', size: '2x4', price: 0.6, per: 'linear-ft' }).project;
    expect(Object.keys(p.prices!)).toEqual(['spf-no2|2x4']);
    expect(p.prices!['spf-no2|2x4']!.usd).toBe(0.6);
  });

  it('refuses in plain sentences', () => {
    const p = empty();
    expect(runErr(p, 'set_price', { material: 'spf-n02', price: 1, per: 'linear-ft' })[0]).toMatchObject({
      code: 'not_found',
      message: 'There\'s no material "spf-n02".',
      hint: 'Did you mean "spf-no2"?',
    });
    expect(runErr(p, 'set_price', { material: 'spf-no2', price: 5, per: 'each' })[0]).toMatchObject({
      path: 'length',
      message: 'A price per board needs the board length, e.g. length: 8ft.',
    });
    expect(runErr(p, 'set_price', { material: 'spf-no2', price: 5, per: 'cu-yd' })[0]).toMatchObject({
      path: 'per',
      message: "SPF No.2 lumber can't be priced per cubic yard; price it per linear foot or each.",
    });
    expect(runErr(p, 'set_price', { material: 'concrete-3000', price: 5, per: 'sheet' })[0]!.message).toBe(
      "3000 psi concrete can't be priced per sheet; price it per cubic yard.",
    );
    expect(runErr(p, 'set_price', { material: 'spf-no2', price: 1, per: 'linear-ft', length: '8ft' })[0]!.message).toBe(
      'A length only goes with a price per board (per: each).',
    );
    expect(runErr(p, 'set_price', { material: 'site-context', price: 1, per: 'each' })[0]!.message).toBe(
      "Site context (not built) isn't built, so it has no price.",
    );
    expect(runErr(p, 'set_price', { material: 'spf-no2', size: '2x5', price: 1, per: 'linear-ft' })[0]).toMatchObject({ path: 'size', code: 'not_found' });
    expect(runErr(p, 'set_price', { material: 'plywood-cdx', size: 'thick', price: 1, per: 'sheet' })[0]!.message).toBe(
      'Couldn\'t read "thick" as a thickness; try 23/32in or 1/2in.',
    );
    expect(runErr(p, 'set_price', { material: 'spf-no2', price: 0, per: 'linear-ft' })[0]!.path).toBe('price');
  });
});

describe('clear_price', () => {
  it('removes a price, and undo puts it back', () => {
    const p = runOk(empty(), 'set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' }).project;
    const res = expectRoundTrip(p, 'clear_price', { material: 'spf-no2', size: '2x4' });
    expect(res.project.prices).toBeUndefined();
    expect(res.summary).toBe('Cleared your price for SPF No.2 lumber 2x4; using the price table.');
  });

  it('says what is there when the price to clear is not', () => {
    const p = runOk(empty(), 'set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' }).project;
    expect(runErr(p, 'clear_price', { material: 'spf-no2' })[0]).toMatchObject({
      code: 'not_found',
      message: 'This project has no price of its own for SPF No.2 lumber.',
      hint: 'It has one for 2x4.',
    });
    expect(runErr(empty(), 'clear_price', { material: 'nope' })[0]!.code).toBe('not_found');
  });
});

describe('user prices on the bus and in files', () => {
  it('undo and redo through the bus', () => {
    const bus = makeBus();
    expect(bus.execute('set_price', { material: 'spf-no2', price: 0.5, per: 'linear-ft' }).ok).toBe(true);
    expect(bus.project.prices).toBeDefined();
    expect(bus.undo().ok).toBe(true);
    expect(bus.project.prices).toBeUndefined();
    expect(bus.redo().ok).toBe(true);
    expect(bus.project.prices!['spf-no2']!.usd).toBe(0.5);
  });

  it('a project with prices round-trips through JSON, and one without still loads', () => {
    const p: Project = runOk(empty(), 'set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' }).project;
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual({ ok: true, project: p });
    expect(migrateProject(JSON.parse(JSON.stringify(empty()))).ok).toBe(true);
  });
});
