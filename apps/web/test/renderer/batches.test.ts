import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { formatErrors, partBox } from '@slapdash/core';
import { batchKey, cutShapeKey, groupParts, idHash, partMatrix, partVariation } from '../../src/renderer/batches.ts';
import { sampleBus, sampleProject } from './fixtures.ts';

describe('groupParts', () => {
  const project = sampleProject();
  const batches = groupParts(project);

  it('groups the sample shell by material and section', () => {
    const keys = batches.map((b) => b.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('spf-no2|2x4');
    expect(keys).toContain('pt-spf-no2|2x4');
    expect(keys).toContain('spf-no2|2x10');
    expect(keys).toContain('osb-7-16|none');
    expect(keys).toContain('concrete-3000|none');
    for (const b of batches) {
      expect(b.parts.every((p) => p.materialId === b.materialId && (p.sectionId ?? null) === b.sectionId)).toBe(true);
      const ids = b.parts.map((p) => p.id);
      expect(ids).toEqual([...ids].sort());
    }
    expect(batches.reduce((n, b) => n + b.parts.length, 0)).toBe(Object.keys(project.parts).length);
  });

  it('leaves stippled site context out', () => {
    const withContext = sampleBus({ context: true }).project;
    const all = groupParts(withContext).flatMap((b) => b.parts);
    expect(all.some((p) => p.tags.includes('stippled'))).toBe(false);
  });

  it('after moving one stud, only that stud’s batch is a new object', () => {
    const bus = sampleBus();
    const before = groupParts(bus.project);
    const stud = Object.values(bus.project.parts).find((p) => p.id === 'W1-S03')!;
    const res = bus.execute('move_parts', { ids: [stud.id], by: { x: 10, y: 0, z: 0 } });
    if (!res.ok) throw new Error(formatErrors(res.errors));
    const after = groupParts(bus.project, before);
    for (const b of after) {
      const old = before.find((x) => x.key === b.key)!;
      if (b.key === 'spf-no2|2x4') expect(b).not.toBe(old);
      else expect(b, b.key).toBe(old);
    }
  });
});

describe('cut batches', () => {
  const project = sampleProject();
  const batches = groupParts(project);

  it('puts cut parts in their own keyed batches, and identical rafters share one', () => {
    const cut = batches.filter((b) => b.cutShape);
    expect(cut.length).toBeGreaterThan(0);
    for (const b of cut) {
      expect(b.key).toMatch(/\|cut:/);
      expect(b.key.startsWith(`${b.materialId}|${b.sectionId ?? 'none'}|cut:${b.cutShape!.key}`)).toBe(true);
      expect(b.parts.every((p) => cutShapeKey(p) === b.cutShape!.key)).toBe(true);
    }
    for (const b of batches.filter((x) => !x.cutShape)) expect(b.parts.every((p) => !p.cuts)).toBe(true);
    // Every common rafter of the gable has the same size and cuts: one batch (side mirrors
    // land in the same local shape).
    const rafters = Object.values(project.parts).filter((p) => p.role === 'rafter');
    expect(rafters.length).toBe(32);
    expect(new Set(rafters.map(batchKey)).size).toBe(1);
  });

  it('keeps the draw calls near the uncut count (16 × 20 gable shell)', () => {
    const uncut = { ...project, parts: Object.fromEntries(Object.entries(project.parts).map(([id, p]) => [id, { ...p, cuts: undefined }])) };
    const before = groupParts(uncut).length;
    expect(batches.length).toBeLessThanOrEqual(before + 6);
  });

  it('reuses unchanged cut batches by reference', () => {
    const again = groupParts(project, batches);
    for (const b of again) expect(b).toBe(batches.find((x) => x.key === b.key));
  });

  it('partMatrix still scales a cut part by its size', () => {
    const rafter = Object.values(project.parts).find((p) => p.role === 'rafter')!;
    expect(rafter.cuts).toBeDefined();
    const c = new Vector3(0.5, 0.5, 0.5).applyMatrix4(partMatrix(rafter));
    const want = partBox(rafter).center;
    expect(c.x).toBeCloseTo(want.x / 1000, 6);
    expect(c.y).toBeCloseTo(want.y / 1000, 6);
    expect(c.z).toBeCloseTo(want.z / 1000, 6);
  });
});

describe('partMatrix', () => {
  it('maps the unit-box centre to the part centre (rotated rafters, slab, studs)', () => {
    const project = sampleProject();
    const picks = Object.values(project.parts).filter((p) => p.role === 'rafter' || p.role === 'slab' || p.id === 'W2-S01' || p.role === 'footing');
    expect(picks.length).toBeGreaterThan(30);
    for (const part of picks) {
      const c = new Vector3(0.5, 0.5, 0.5).applyMatrix4(partMatrix(part));
      const want = partBox(part).center;
      expect(c.x, part.id).toBeCloseTo(want.x / 1000, 6);
      expect(c.y, part.id).toBeCloseTo(want.y / 1000, 6);
      expect(c.z, part.id).toBeCloseTo(want.z / 1000, 6);
    }
  });

  it('lifts a part for the drop-in animation', () => {
    const part = sampleProject().parts['W1-S01']!;
    const lifted = new Vector3(0, 0, 0).applyMatrix4(partMatrix(part, undefined, 0.3));
    expect(lifted.y).toBeCloseTo(part.position.y / 1000 + 0.3, 6);
  });
});

describe('per-board variation', () => {
  it('is stable per id and within ±4%', () => {
    expect(idHash('W1-S01')).toBe(idHash('W1-S01'));
    expect(idHash('W1-S01')).not.toBe(idHash('W1-S02'));
    for (const id of Object.keys(sampleProject().parts)) {
      const [seed, tint] = partVariation(id);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
      expect(Math.abs(tint)).toBeLessThanOrEqual(0.04);
    }
  });
});
