import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS, type AssemblyKind } from '@slapdash/core';
import { FLOOR_KINDS, INSIDE_CUT_HEIGHT_MM, cutPlaneFor, isCuttable, isKindVisible, isPartVisible, type FloorId, type LookFrom } from '../../src/renderer/visibility.ts';
import { sampleProject } from './fixtures.ts';

const FLOORS: FloorId[] = ['roof', 'floor-1', 'foundation'];
const LOOKS: LookFrom[] = ['outside', 'inside'];

describe('Floors × Look from', () => {
  // What each combination shows, by assembly kind.
  const expected: Record<FloorId, Record<LookFrom, AssemblyKind[]>> = {
    roof: {
      outside: ['foundation', 'floor', 'wall', 'roof', 'opening', 'structure', 'site', 'misc'],
      inside: ['foundation', 'floor', 'wall', 'opening', 'structure', 'site', 'misc'],
    },
    'floor-1': {
      outside: ['foundation', 'floor', 'wall', 'opening', 'structure', 'site', 'misc'],
      inside: ['foundation', 'floor', 'wall', 'opening', 'structure', 'site', 'misc'],
    },
    foundation: {
      outside: ['foundation', 'structure', 'site'],
      inside: ['foundation', 'structure', 'site'],
    },
  };
  for (const floor of FLOORS) {
    for (const lookFrom of LOOKS) {
      it(`${floor} / ${lookFrom}`, () => {
        const shown = ASSEMBLY_KINDS.filter((k) => isKindVisible(k, { floor, lookFrom }));
        expect(shown.sort()).toEqual([...expected[floor][lookFrom]].sort());
      });
    }
  }

  it('Inside hides the roof at every floor', () => {
    for (const floor of FLOORS) expect(isKindVisible('roof', { floor, lookFrom: 'inside' })).toBe(false);
  });

  it('each floor shows everything the one below it shows', () => {
    for (const k of FLOOR_KINDS.foundation) expect(FLOOR_KINDS['floor-1'].has(k)).toBe(true);
    for (const k of FLOOR_KINDS['floor-1']) expect(FLOOR_KINDS.roof.has(k)).toBe(true);
  });

  it('applies to parts through their assembly; an orphan part stays visible', () => {
    const p = sampleProject();
    const rafter = Object.values(p.parts).find((x) => x.role === 'rafter')!;
    expect(isPartVisible(rafter, p.assemblies[rafter.assemblyId], { floor: 'roof', lookFrom: 'outside' })).toBe(true);
    expect(isPartVisible(rafter, p.assemblies[rafter.assemblyId], { floor: 'floor-1', lookFrom: 'outside' })).toBe(false);
    expect(isPartVisible(rafter, undefined, { floor: 'foundation', lookFrom: 'inside' })).toBe(true);
  });
});

describe('the Inside cut', () => {
  it('is 4′ 0″ (1219.2 mm) above the level, and only when looking from inside', () => {
    const levels = sampleProject().levels;
    expect(INSIDE_CUT_HEIGHT_MM).toBe(1219.2);
    expect(cutPlaneFor('inside', levels)).toBeCloseTo(1219.2, 6);
    expect(cutPlaneFor('outside', levels)).toBeNull();
    expect(cutPlaneFor('inside', [{ id: 'L0', name: 'Ground', elevation_mm: 300 }])).toBeCloseTo(1519.2, 6);
  });

  it('cuts walls, openings, structures and misc; never the slab, foundation or floor', () => {
    expect(['wall', 'opening', 'structure', 'misc'].every((k) => isCuttable(k as AssemblyKind))).toBe(true);
    expect(['foundation', 'floor', 'roof', 'site'].some((k) => isCuttable(k as AssemblyKind))).toBe(false);
  });
});
