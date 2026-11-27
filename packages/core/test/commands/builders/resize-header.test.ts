import { describe, expect, it } from 'vitest';
import { KPA_PER_PSF, createProject, findAllClashes, type Project } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';
import { unitCtx, unitParts } from './unit-fixtures.ts';

const IN = 25.4;

/** The pool house's south wall: slab, the four walls and the sliding door (O1 in W3). */
function poolHouse(): Project {
  let p = runOk(createProject({ name: 'Pool house' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
  p = runOk(p, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }).project;
  p = runOk(p, 'build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' }).project;
  p = runOk(p, 'build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' }).project;
  return runOk(p, 'add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' }).project;
}

const headers = (p: Project, o = 'O1') => Object.values(p.parts).filter((x) => x.role === 'header' && x.tags.includes(`opening:${o}`));
const cripplesAbove = (p: Project, o = 'O1') =>
  Object.values(p.parts).filter((x) => x.role === 'stud' && x.tags.includes('cripple') && x.tags.includes(`opening:${o}`));
const jointsOf = (p: Project, id: string) => Object.values(p.joints).filter((j) => j.partIds.includes(id));

function undersized(): Project {
  let p = poolHouse();
  for (const h of headers(p)) p = runOk(p, 'update_part', { id: h.id, sectionId: '2x4' }).project;
  return p;
}

describe('resize_header', () => {
  it('restores the table size over an undersized header, with no clashes', () => {
    const before = undersized();
    expect(headers(before).every((h) => h.sectionId === '2x4')).toBe(true);
    const res = expectRoundTrip(before, 'resize_header', { opening: 'O1' });
    const p = res.project;
    const hs = headers(p);
    expect(hs).toHaveLength(2);
    expect(hs.every((h) => h.sectionId === '2x10' && Math.abs(h.size.length - 78 * IN) < 1e-6)).toBe(true);
    for (const h of hs) expect(jointsOf(p, h.id).length).toBeGreaterThan(0);
    for (const c of cripplesAbove(p)) {
      expect(jointsOf(p, c.id).length).toBeGreaterThan(0);
      // From the header top (80 1/2 + 9 1/4in) up to the underside of the top plate (105in), from the slab top.
      expect(c.size.length).toBeCloseTo((105 - 80.5 - 9.25) * IN, 6);
    }
    expect(findAllClashes(p)).toEqual([]);
    expect(p.assemblies.O1!.builder!.params).toMatchObject({ header: { plies: 2, sectionId: '2x10', flat: false } });
    expect(res.summary).toContain("Re-framed O1's header in W3: 2-2x4 → 2-2x10");
    expect(res.summary).toContain('30 psf ground snow load');
    expect(res.redo.name).toBe('patch_entities');
  });

  it('takes a header ply ID instead of the opening', () => {
    const p = undersized();
    const res = runOk(p, 'resize_header', { opening: headers(p)[0]!.id });
    expect(headers(res.project).every((h) => h.sectionId === '2x10')).toBe(true);
  });

  it('sizes for the resolved snow load: 70 psf gets a deeper header and shorter cripples', () => {
    const at30 = poolHouse();
    const at70 = runOk(at30, 'set_design_load', { key: 'groundSnow', value: '70 psf', source: 'user' }).project;
    const res = expectRoundTrip(at70, 'resize_header', { opening: 'O1' });
    // 72in at 70 psf, 24ft column: 2-2x10 spans 5' 3", 2-2x12 spans 6' 2" (NJ 2).
    expect(headers(res.project).every((h) => h.sectionId === '2x12')).toBe(true);
    expect(cripplesAbove(res.project)[0]!.size.length).toBeLessThan(cripplesAbove(at30)[0]!.size.length - 1);
    expect(findAllClashes(res.project)).toEqual([]);
    expect(res.summary).toContain("the project's 70 psf ground snow load");
  });

  it('uses the app site defaults (the loads table) when no override is set', () => {
    const p = poolHouse();
    const table = { 'snowy, st': { label: 'Snowy, ST', loads: { groundSnow: { value: 70 * KPA_PER_PSF, unit: 'kPa' as const, source: 'test table' } } } };
    const res = runOk(p, 'resize_header', { opening: 'O1' }, { siteDefaults: { location: { label: 'Snowy, ST' }, table } });
    expect(headers(res.project).every((h) => h.sectionId === '2x12')).toBe(true);
    expect(res.summary).toContain("Snowy, ST's 70 psf ground snow load (test table)");
  });

  it('takes an explicit size', () => {
    const res = expectRoundTrip(poolHouse(), 'resize_header', { opening: 'O1', size: '2-2x12' });
    expect(headers(res.project)).toHaveLength(2);
    expect(headers(res.project).every((h) => h.sectionId === '2x12')).toBe(true);
    expect(res.project.assemblies.O1!.builder!.params).toMatchObject({ header: { plies: 2, sectionId: '2x12' }, headerRule: '2-2x12, as asked' });
    expect(findAllClashes(res.project)).toEqual([]);
  });

  it('refusals', () => {
    const p = poolHouse();
    expect(runErr(p, 'resize_header', { opening: 'O1', size: 'big' })[0]).toMatchObject({ path: 'size', message: 'Couldn\'t read "big" as a header size.' });
    expect(runErr(p, 'resize_header', { opening: 'O1', size: '2-2x14' })[0]).toMatchObject({ code: 'not_found', path: 'size' });
    expect(runErr(p, 'resize_header', { opening: 'O1', size: '4-2x10' })[0]!.message).toContain('fits at most 2 plies');
    expect(runErr(p, 'resize_header', { opening: 'O9' })[0]).toMatchObject({ code: 'not_found', path: 'opening' });
    expect(runErr(p, 'resize_header', { opening: 'W3-S01' })[0]!.message).toContain("not an opening's header");
    expect(runErr(p, 'resize_header', {})[0]!.message).toBe('"opening" is required.');

    // A tall window in an 8ft wall: 2-2x4 fits under the top plate, 2-2x10 doesn't.
    let w = runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
    w = runOk(w, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '8ft' }).project;
    w = runOk(w, 'add_opening', { wallId: 'W1', kind: 'window', centerAt: '8ft', sillHeight: '40in' }).project;
    expect(runErr(w, 'resize_header', { opening: 'O1', size: '2-2x10' })[0]!.message).toContain("A 2-2x10 header doesn't fit over O1");

    // Past the table: 80 psf.
    const heavy = runOk(p, 'set_design_load', { key: 'groundSnow', value: '80 psf', source: 'user' }).project;
    expect(runErr(heavy, 'resize_header', { opening: 'O1' })[0]!.message).toContain('needs an engineered beam');
  });
});

describe('resize_header keeps the window or door unit nailed to the header', () => {
  it('joins the unit head to the new plies, as add_opening joined it to the old ones', () => {
    let p = runOk(createProject({ name: 'Pool house' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
    p = runOk(p, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft' }).project;
    p = runOk(p, 'add_opening', { wallId: 'W1', kind: 'window', centerAt: '10ft' }, unitCtx).project;
    const head = unitParts(p).find((x) => x.tags.includes('unit:head'))!;
    const before = jointsOf(p, head.id).filter((j) => j.partIds.some((id) => p.parts[id]!.role === 'header'));
    expect(before).toHaveLength(2);
    const res = expectRoundTrip(p, 'resize_header', { opening: 'O1', size: 'flat 2x4' }, unitCtx);
    const after = jointsOf(res.project, head.id).filter((j) => j.partIds.some((id) => res.project.parts[id]!.role === 'header'));
    expect(after).toHaveLength(1);
    for (const j of after) expect(j.jointTypeId).toBe(before[0]!.jointTypeId);
    expect(findAllClashes(res.project)).toEqual([]);
  });
});
