/**
 * Window and door units drawn as real pieces (LOC-124): frames, sashes of stiles and rails,
 * glass in the daylight openings, door slabs and leaves, fins and casing.
 */
import { describe, expect, it } from 'vitest';
import { findAllClashes, type Project } from '../../src/index.ts';
import { expectRoundTrip, expectSound, runOk } from '../helpers.ts';
import { IN, poolWalls } from '../commands/builders/opening-fixtures.ts';
import { UNIT_CATALOG, bounds, piece, unitCtx, unitParts, wallBox } from '../commands/builders/unit-fixtures.ts';

const SH = (7 / 16) * IN;
const D = 3.5 * IN;
const window = (extra: Record<string, unknown> = {}) => ({ wallId: 'W1', kind: 'window', centerAt: '10ft', ...extra });
const door = (extra: Record<string, unknown> = {}) => ({ wallId: 'W3', kind: 'door', centerAt: '10ft', ...extra });
const slider = (extra: Record<string, unknown> = {}) => ({ wallId: 'W3', kind: 'sliding-door', centerAt: '10ft', ...extra });
const add = (input: Record<string, unknown>, p: Project = poolWalls()) => expectRoundTrip(p, 'add_opening', input, unitCtx);
const roles = (p: Project) =>
  unitParts(p)
    .map((x) => x.role)
    .reduce<Record<string, number>>((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {});
const ro = (p: Project) => p.assemblies.O1!.builder!.params as { at: number; width: number; height: number; roBottom: number; roTop: number };
const sashTag = (x: { tags: string[] }) => x.tags.find((t) => t.startsWith('sash:'));
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

/** The joints from a unit's parts to the wall framing, and those among the unit's own parts. */
function unitJointsOf(p: Project) {
  const ids = new Set(unitParts(p).map((x) => x.id));
  const all = Object.values(p.joints).filter((j) => j.partIds.some((id) => ids.has(id)));
  return { attach: all.filter((j) => j.partIds.some((id) => !ids.has(id))), internal: all.filter((j) => j.partIds.every((id) => ids.has(id))) };
}

const STYLES: Array<[string, Record<string, unknown>]> = [
  ['casement (generic)', window()],
  ['fixed', window({ product: 'win-fixed' })],
  ['awning', window({ product: 'win-awning' })],
  ['double-hung', window({ product: 'win-double-hung' })],
  ['single-hung', window({ product: 'win-single-hung' })],
  ['slider', window({ product: 'win-slider' })],
  ['twin casement', window({ product: 'win-twin' })],
  ['entry (generic)', door()],
  ['entry with casing', door({ product: 'door-slab' })],
  ['french', door({ product: 'door-french', width: '62in' })],
  ['sliding (generic)', slider()],
  ['sliding', slider({ product: 'door-glass' })],
];

describe('every style', () => {
  it.each(STYLES)('%s: sound, every part a unit part of the product in O1, joined to the framing like the old panel', (_name, input) => {
    const p = add(input).project;
    expect(findAllClashes(p)).toEqual([]);
    expectSound(p, UNIT_CATALOG);
    const parts = unitParts(p);
    const product = (input.product as string | undefined) ?? 'opening-unit';
    expect(parts.length).toBeGreaterThan(4);
    for (const x of parts) {
      expect(x).toMatchObject({ assemblyId: 'O1', materialId: product, buildStep: { phase: 'openings' } });
      expect(x.sectionId).toBeUndefined();
      expect(x.tags.slice(0, 3)).toEqual([input.kind, 'opening:O1', 'unit']);
    }
    expect(Object.values(p.parts).filter((x) => x.role === 'panel' && x.assemblyId === 'O1')).toEqual([]);
    expect(piece(parts, 'jamb')).toHaveLength(2);
    expect(piece(parts, 'head')).toHaveLength(1);
    expect(piece(parts, input.kind === 'window' ? 'sill' : 'threshold')).toHaveLength(1);

    // Nailed to the framing where the old panel was: both jacks, every header ply, and the
    // rough sill (windows) or the ends of the cut bottom plate (doors).
    const { attach, internal } = unitJointsOf(p);
    const plies = Object.values(p.parts).filter((x) => x.role === 'header' && x.tags.includes('opening:O1')).length;
    expect(attach).toHaveLength(2 + plies + (input.kind === 'window' ? 1 : 2));
    for (const j of attach) expect(j.partIds.some((id) => p.parts[id]!.role === 'frame'), j.id).toBe(true);
    // Held together at the factory: one joint per piece, to the bottom frame piece.
    expect(internal).toHaveLength(parts.length - 1);
    const anchor = piece(parts, input.kind === 'window' ? 'sill' : 'threshold')[0]!;
    for (const j of internal) {
      expect(j.jointTypeId).toBe('factory-assembled');
      expect(j.partIds).toContain(anchor.id);
    }
  });

  it.each(STYLES)('%s: safety glazing marks the glass only', (_name, input) => {
    const p = runOk(poolWalls(), 'add_opening', { ...input, safetyGlazing: true }, unitCtx).project;
    for (const x of unitParts(p)) expect(x.tags.includes('safety-glazing'), x.id).toBe(x.role === 'glass');
  });

  it.each(STYLES)('%s: a tiny 14in × 14in opening still frames (fewer pieces, never refused)', (_name, input) => {
    const p = runOk(poolWalls(), 'add_opening', { ...input, width: '14in', height: input.kind === 'window' ? '14in' : '30in' }, unitCtx).project;
    expectSound(p, UNIT_CATALOG);
    expect(piece(unitParts(p), 'jamb')).toHaveLength(2);
  });
});

describe('a casement window (the generic unit)', () => {
  const p = add(window()).project;
  const parts = unitParts(p);

  it('is a frame, a fin, one sash and one glass lite', () => {
    expect(roles(p)).toEqual({ frame: 8, sash: 4, glass: 1 });
    expect(piece(parts, 'flange')).toHaveLength(4);
    expect(p.assemblies.O1!.builder!.params).toMatchObject({ style: 'casement' });
  });

  it('sits in the rough opening with 1/2in at the sides and head, on the rough sill, from the sheathing face (plus the fin setback) to the inside of the studs', () => {
    const r = ro(p);
    const b = bounds(p, parts.filter((x) => x.role === 'frame' && !x.tags.includes('unit:flange')));
    expect(b.u0).toBeCloseTo(r.at + 0.5 * IN, 6);
    expect(b.u1).toBeCloseTo(r.at + r.width - 0.5 * IN, 6);
    expect(b.v0).toBeCloseTo(r.roBottom, 6);
    expect(b.v1 - b.v0).toBeCloseTo(r.height - 0.5 * IN, 6);
    expect(b.w0).toBeCloseTo(-SH - 1 * IN, 6);
    expect(b.w1).toBeCloseTo(D, 6);
  });

  it('the fin lies on the sheathing face and covers the shim gap', () => {
    for (const f of piece(parts, 'flange')) {
      const b = wallBox(p, f);
      expect(b.w0).toBeCloseTo(-SH - 1.6, 6);
      expect(b.w1).toBeCloseTo(-SH, 6);
    }
    const fins = bounds(p, piece(parts, 'flange'));
    expect(fins.u0).toBeLessThan(ro(p).at);
  });

  it('the glass is 3/4in insulated glass, centred in the sash and exactly in its daylight opening', () => {
    const glass = wallBox(p, piece(parts, 'glass')[0]!);
    const stiles = piece(parts, 'stile').map((x) => wallBox(p, x));
    expect(glass.w1 - glass.w0).toBeCloseTo(19.05, 6);
    expect((glass.w0 + glass.w1) / 2).toBeCloseTo((stiles[0]!.w0 + stiles[0]!.w1) / 2, 6);
    const us = stiles.map((s) => [s.u0, s.u1]).sort((a, b) => a[0]! - b[0]!);
    expect(glass.u0).toBeCloseTo(us[0]![1]!, 6);
    expect(glass.u1).toBeCloseTo(us[1]![0]!, 6);
  });
});

describe('two-sash styles', () => {
  it('double-hung: two sashes on separate tracks, overlapping by the meeting rail', () => {
    const p = add(window({ product: 'win-double-hung' })).project;
    const parts = unitParts(p);
    expect(piece(parts, 'meeting-rail')).toHaveLength(2);
    const s0 = bounds(p, parts.filter((x) => sashTag(x) === 'sash:0' && x.role === 'sash'));
    const s1 = bounds(p, parts.filter((x) => sashTag(x) === 'sash:1' && x.role === 'sash'));
    expect(overlap(s0.w0, s0.w1, s1.w0, s1.w1)).toBeLessThanOrEqual(1e-6);
    expect(s0.w0).toBeLessThan(s1.w0); // the upper sash is outside
    expect(s0.v0).toBeGreaterThan(s1.v0);
    expect(overlap(s0.v0, s0.v1, s1.v0, s1.v1)).toBeCloseTo(1.25 * IN, 6);
    expect(piece(parts, 'glass')).toHaveLength(2);
  });

  it('slider: two sashes overlapping by one stile, the start one sliding', () => {
    const p = add(window({ product: 'win-slider' })).project;
    const parts = unitParts(p);
    const s0 = bounds(p, parts.filter((x) => sashTag(x) === 'sash:0' && x.role === 'sash'));
    const s1 = bounds(p, parts.filter((x) => sashTag(x) === 'sash:1' && x.role === 'sash'));
    expect(overlap(s0.u0, s0.u1, s1.u0, s1.u1)).toBeCloseTo(1.5 * IN, 6);
    expect(overlap(s0.w0, s0.w1, s1.w0, s1.w1)).toBeLessThanOrEqual(1e-6);
    expect(parts.filter((x) => x.tags.includes('slides:toward-end')).every((x) => sashTag(x) === 'sash:0')).toBe(true);
  });

  it('a twin casement has a mullion between two lites', () => {
    const parts = unitParts(add(window({ product: 'win-twin' })).project);
    expect(piece(parts, 'mullion')).toHaveLength(1);
    expect(piece(parts, 'glass')).toHaveLength(2);
  });
});

describe('doors', () => {
  it('entry: one slab hinged at the start, swinging in, over a threshold on the floor, with brickmould', () => {
    const p = add(door({ product: 'door-slab' })).project;
    const parts = unitParts(p);
    expect(roles(p)).toEqual({ frame: 4, door: 1, trim: 3 });
    const slab = piece(parts, 'slab')[0]!;
    expect(slab.tags).toEqual(expect.arrayContaining(['hinge:start', 'swing:in', 'sash:0']));
    const threshold = wallBox(p, piece(parts, 'threshold')[0]!);
    expect(threshold.v0).toBeCloseTo(0, 6);
    for (const c of piece(parts, 'casing')) {
      expect(c.role).toBe('trim');
      expect(wallBox(p, c).w1).toBeCloseTo(-SH, 6);
    }
    expect(piece(parts, 'glass')).toEqual([]);
  });

  it('a door with no unit of its own is a flat slab in a frame, with no glass', () => {
    const p = add(door()).project;
    expect(roles(p)).toEqual({ frame: 4, door: 1 });
    expect(p.assemblies.O1!.builder!.params).toMatchObject({ style: 'entry' });
  });

  it('french: two leaves, hinged at each side, each with glass', () => {
    const p = add(door({ product: 'door-french', width: '62in' })).project;
    const parts = unitParts(p);
    for (const [n, hinge] of [['sash:0', 'hinge:start'], ['sash:1', 'hinge:end']] as const) {
      const leaf = parts.filter((x) => x.tags.includes(n));
      expect(leaf.every((x) => x.tags.includes(hinge) && x.tags.includes('swing:in'))).toBe(true);
      expect(leaf.filter((x) => x.role === 'glass')).toHaveLength(1);
    }
  });

  it('sliding: one panel operable, one fixed', () => {
    const parts = unitParts(add(slider()).project);
    const panels = new Map<string, string[]>();
    for (const x of parts.filter((y) => sashTag(y))) panels.set(sashTag(x)!, x.tags);
    expect(panels.get('sash:0')).toContain('operable');
    expect(panels.get('sash:1')).toContain('fixed');
  });
});

it('a product whose style does not fit the kind falls back to the kind default, with a note', () => {
  const res = runOk(poolWalls(), 'add_opening', door({ product: 'win-double-hung' }), unitCtx);
  expect(res.summary).toContain("doesn't fit a door");
  expect(res.project.assemblies.O1!.builder!.params).toMatchObject({ style: 'entry', product: 'win-double-hung' });
  expect(roles(res.project).door).toBe(1);
});

it('describes the opening with its style', () => {
  const res = runOk(poolWalls(), 'add_opening', window(), unitCtx);
  expect(res.summary).toContain(`3' 0" × 4' 0" window (casement), `);
});
