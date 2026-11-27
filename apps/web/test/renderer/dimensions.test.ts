import { describe, expect, it } from 'vitest';
import { partAabb } from '../../src/renderer/bounds.ts';
import { dimensionLabel, dimensionSet } from '../../src/renderer/dimensions.ts';
import { isPartVisible } from '../../src/renderer/visibility.ts';
import { sampleProject } from './fixtures.ts';

const project = sampleProject();
const visibleWith = (floor: 'roof' | 'floor-1' | 'foundation', lookFrom: 'outside' | 'inside' = 'outside') => (part: (typeof project.parts)[string]) =>
  isPartVisible(part, project.assemblies[part.assemblyId], { floor, lookFrom });

describe('dimensionSet on the pool-house shell', () => {
  const lines = dimensionSet(project, visibleWith('roof'));
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));

  it('gives the footprint, the wall height and the ridge in feet and inches with primes', () => {
    expect(byId.length!.label).toBe('20′ 0″');
    expect(byId.width!.label).toBe('16′ 0″');
    expect(byId['wall-height']!.label).toBe('9′ 0″');
    // Ridge: slab top (4″) to the top of the roof.
    const roofTop = Math.max(...Object.values(project.parts).filter((p) => p.assemblyId === 'R1').map((p) => partAabb(p).max.y));
    expect(byId['ridge-height']!.label).toBe(dimensionLabel(roofTop - 101.6));
    // The roof apex is where the bevelled sheathing meets on the ridge centreline:
    //   9′ 4″ plate top (112″) + rafter underside rise to the ridge face (96 − 3/4 + 7/16)″ × 6/12
    //   − birdsmouth heel (7/16 + 3 1/2)″ × 6/12 + rafter plumb depth 5 1/2″ / cos θ
    //   + 3/4″ × 6/12 to the centreline + sheathing 7/16″ / cos θ = 164.88″ = 13′ 8 7/8″,
    // so 13′ 4 7/8″ above the 4″ slab. (Square-cut, un-notched rafters gave 13′ 6″.)
    expect(byId['ridge-height']!.label).toBe('13′ 4 7/8″');
    expect(byId['ridge-height']!.to.y).toBeGreaterThan(byId['wall-height']!.to.y);
  });

  it('measures each opening at its rough-opening width along its wall', () => {
    expect(byId['opening-O1']!.label).toBe('6′ 0″'); // the 72″ sliding door
    expect(byId['opening-O2']!.label).toBe('3′ 0″'); // the 36″ window
    // The door is in the south wall (z = 16 ft), drawn outside it (+z).
    expect(byId['opening-O1']!.from.z).toBeCloseTo(4876.8, 3);
    expect(byId['opening-O1']!.offset.z).toBeGreaterThan(0);
    // The window is in the east wall (x = 20 ft), drawn outside it (+x).
    expect(byId['opening-O2']!.from.x).toBeCloseTo(6096, 3);
    expect(byId['opening-O2']!.offset.x).toBeGreaterThan(0);
  });

  it('draws the footprint on the front (south) and east edges, outside the building', () => {
    expect(byId.length!.from.z).toBeCloseTo(4876.8, 3);
    expect(byId.length!.offset.z).toBeGreaterThan(0);
    expect(byId.width!.from.x).toBeCloseTo(6096, 3);
    expect(byId.width!.offset.x).toBeGreaterThan(0);
  });

  it('has no ridge when the roof is hidden, and only the footprint at Foundation', () => {
    expect(dimensionSet(project, visibleWith('roof', 'inside')).map((l) => l.id)).not.toContain('ridge-height');
    expect(dimensionSet(project, visibleWith('floor-1')).map((l) => l.id)).not.toContain('ridge-height');
    expect(dimensionSet(project, visibleWith('foundation')).map((l) => l.id).sort()).toEqual(['length', 'width']);
  });

  it('is empty when nothing is visible', () => {
    expect(dimensionSet(project, () => false)).toEqual([]);
  });
});
