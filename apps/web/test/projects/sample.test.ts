import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, PRICE_TABLE } from '@slapdash/catalog';
import { buildStepGroups, isUnitPart, takeoff, type Project } from '@slapdash/core';
import { decodeSlapdashFile } from '@slapdash/storage';
import { describe, expect, it } from 'vitest';
import { buildSampleText, SAMPLE_FILE_NAME } from '../../src/samples/build.ts';

const shipped = readFileSync(join(import.meta.dirname, '../../src/samples', SAMPLE_FILE_NAME), 'utf8');

describe('the shipped sample pool house', () => {
  it('decodes as a named "Pool house" with no history or chat', () => {
    const decoded = decodeSlapdashFile(shipped);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.record.meta).toMatchObject({ name: 'Pool house', named: true });
    expect(decoded.record.project.name).toBe('Pool house');
    expect(decoded.record.history).toBeNull();
    expect(decoded.record.chat.messages).toEqual([]);
    expect(decoded.files).toEqual([]);
  });

  it('builds in three steps: Slab, Walls, Roof', () => {
    const decoded = decodeSlapdashFile(shipped);
    if (!decoded.ok) throw new Error(decoded.errors.join('\n'));
    expect(buildStepGroups(decoded.record.project, CATALOG).map((g) => g.title)).toEqual(['Slab', 'Walls', 'Roof']);
  });

  // The shipped file is frozen at project schema v1 (before part cuts, LOC-120, and before
  // window and door units, LOC-124) on purpose: it is the regression fixture for loading old
  // files, whose openings are single-box `panel` parts. A fresh build is v3 with cut rafters
  // and real units.
  it('is a v1 file that migrates with no cuts', () => {
    expect((JSON.parse(shipped) as { project: { schemaVersion: number } }).project.schemaVersion).toBe(1);
    const decoded = decodeSlapdashFile(shipped);
    if (!decoded.ok) throw new Error(decoded.errors.join('\n'));
    expect(decoded.record.project.schemaVersion).toBe(3);
    for (const part of Object.values(decoded.record.project.parts)) expect(part.cuts).toBeUndefined();
  });

  it('has the same parts as a fresh build, which adds the roof cuts and draws real window and door units', () => {
    const fresh = decodeSlapdashFile(buildSampleText());
    const old = decodeSlapdashFile(shipped);
    if (!fresh.ok || !old.ok) throw new Error('decode failed');
    const f = fresh.record.project;
    const o = old.record.project;
    const isOpening = (p: Project, id: string) => p.assemblies[p.parts[id]!.assemblyId]?.kind === 'opening';
    expect(Object.keys(f.parts).filter((id) => !isOpening(f, id)).sort()).toEqual(Object.keys(o.parts).filter((id) => !isOpening(o, id)).sort());
    // Each opening: one panel in the old file, a unit of many parts in the fresh build.
    const openings = Object.values(o.assemblies).filter((a) => a.kind === 'opening').map((a) => a.id);
    expect(openings.length).toBeGreaterThan(0);
    let extra = 0;
    for (const id of openings) {
      const was = Object.values(o.parts).filter((p) => p.assemblyId === id);
      const now = Object.values(f.parts).filter((p) => p.assemblyId === id);
      expect(was.map((p) => p.role), id).toEqual(['panel']);
      expect(now.length, id).toBeGreaterThan(1);
      expect(now.every(isUnitPart), id).toBe(true);
      extra += now.length - 1;
    }
    // The unit is nailed in just as the panel was; its other pieces each get one factory-assembled joint.
    expect(Object.keys(f.joints).length).toBe(Object.keys(o.joints).length + extra);
    expect(Object.values(f.joints).filter((j) => j.jointTypeId === 'factory-assembled')).toHaveLength(extra);
    const rafters = Object.values(fresh.record.project.parts).filter((p) => p.role === 'rafter');
    expect(rafters.length).toBeGreaterThan(0);
    expect(rafters.every((p) => p.cuts?.end?.name === 'plumb')).toBe(true);
  });

  it('the old panels and the fresh units cost the same', () => {
    const fresh = decodeSlapdashFile(buildSampleText());
    const old = decodeSlapdashFile(shipped);
    if (!fresh.ok || !old.ok) throw new Error('decode failed');
    const walls = (p: Project) => {
      const r = takeoff(p, CATALOG, PRICE_TABLE);
      const g = r.groups.find((x) => x.title === 'Walls')!;
      return g.rows.map((x) => ({ id: x.id, quantity: x.quantity, cost: x.cost }));
    };
    // The Walls rows, units included (the whole-project totals differ: the fresh roof has cut rafters).
    expect(walls(fresh.record.project)).toEqual(walls(old.record.project));
  });
});
