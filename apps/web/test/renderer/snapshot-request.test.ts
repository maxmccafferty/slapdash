import { describe, expect, it } from 'vitest';
import { SnapshotError, expandIds, validateSnapshotRequest, zSnapshotRequest } from '../../src/renderer/snapshot/types.ts';
import { sampleProject } from './fixtures.ts';

const project = sampleProject();

describe('zSnapshotRequest', () => {
  it('defaults to the textured four-view sheet at 768 px', () => {
    expect(zSnapshotRequest.parse({})).toEqual({
      angle: 'sheet',
      mode: 'textured',
      highlight: [],
      labels: false,
      dimensions: false,
      lookFrom: 'outside',
      floor: 'roof',
      size: 768,
    });
  });

  it('accepts a part or assembly to frame', () => {
    expect(zSnapshotRequest.parse({ angle: { frame: 'W3' } }).angle).toEqual({ frame: 'W3' });
  });

  it('bounds the size', () => {
    expect(zSnapshotRequest.safeParse({ size: 255 }).success).toBe(false);
    expect(zSnapshotRequest.safeParse({ size: 2049 }).success).toBe(false);
    expect(zSnapshotRequest.safeParse({ size: 512.5 }).success).toBe(false);
    expect(zSnapshotRequest.safeParse({ size: 2048 }).success).toBe(true);
  });
});

describe('validateSnapshotRequest', () => {
  it('passes a valid request through', () => {
    const res = validateSnapshotRequest({ angle: 'iso', mode: 'blueprint', highlight: ['W3-H01', 'W2'], labels: true }, project);
    expect(res.ok).toBe(true);
  });

  it('refuses stress and exploded in plain language', () => {
    const stress = validateSnapshotRequest({ mode: 'stress' }, project);
    expect(stress.ok ? null : stress.errors[0]).toMatchObject({
      message: "Snapshots can't show the stress view.",
      hint: 'Call check_structure for the most loaded parts and their % of limit.',
    });
    const exploded = validateSnapshotRequest({ mode: 'exploded' }, project);
    expect(exploded.ok ? '' : exploded.errors[0]!.message).toBe('Exploded view was replaced by build steps.');
  });

  it('names unknown ids and suggests close ones', () => {
    const res = validateSnapshotRequest({ highlight: ['W3-H1'], angle: { frame: 'W33' } }, project);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]!.message).toBe('There\'s no part or assembly "W3-H1".');
    expect(res.errors[0]!.hint).toMatch(/Did you mean "W3-H01"\?/);
    expect(res.errors[0]!.path).toBe('highlight[0]');
    expect(res.errors[1]!.path).toBe('angle.frame');
  });

  it('turns schema problems into sentences', () => {
    const res = validateSnapshotRequest({ size: 'big' }, project);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]!.message).toMatch(/"size" should be/);
    expect(res.errors[0]!.message).not.toMatch(/zod|invalid_type/i);
  });

  it('SnapshotError reads as one message', () => {
    const res = validateSnapshotRequest({ highlight: ['W3-H1'] }, project);
    if (res.ok) throw new Error('expected an error');
    expect(new SnapshotError(res.errors).message).toBe('There\'s no part or assembly "W3-H1". Did you mean "W3-H01"?');
  });
});

describe('expandIds', () => {
  it('expands assemblies to their parts and keeps part ids', () => {
    const ids = expandIds(project, ['O1', 'W3-H01']);
    // O1 is a window or door unit: every piece of it (frame, sash, glass or slab).
    const unit = Object.values(project.parts).filter((p) => p.assemblyId === 'O1').map((p) => p.id);
    expect(unit.length).toBeGreaterThan(1);
    expect(unit.every((id) => /^O1-(FR|SA|GL|DR|TR)\d+$/.test(id))).toBe(true);
    for (const id of unit) expect(ids).toContain(id);
    expect(ids).toContain('W3-H01');
    expect(ids).toHaveLength(unit.length + 1);
  });
});
