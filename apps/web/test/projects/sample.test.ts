import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from '@slapdash/catalog';
import { buildStepGroups } from '@slapdash/core';
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

  // The shipped file is frozen at project schema v1 (before part cuts, LOC-120) on purpose:
  // it is the regression fixture for loading old files. A fresh build is v2 with cut rafters.
  it('is a v1 file that migrates with no cuts', () => {
    expect((JSON.parse(shipped) as { project: { schemaVersion: number } }).project.schemaVersion).toBe(1);
    const decoded = decodeSlapdashFile(shipped);
    if (!decoded.ok) throw new Error(decoded.errors.join('\n'));
    expect(decoded.record.project.schemaVersion).toBe(2);
    for (const part of Object.values(decoded.record.project.parts)) expect(part.cuts).toBeUndefined();
  });

  it('has the same parts as a fresh build, which adds the roof cuts', () => {
    const fresh = decodeSlapdashFile(buildSampleText());
    const old = decodeSlapdashFile(shipped);
    if (!fresh.ok || !old.ok) throw new Error('decode failed');
    expect(Object.keys(fresh.record.project.parts).sort()).toEqual(Object.keys(old.record.project.parts).sort());
    expect(Object.keys(fresh.record.project.joints).length).toBe(Object.keys(old.record.project.joints).length);
    const rafters = Object.values(fresh.record.project.parts).filter((p) => p.role === 'rafter');
    expect(rafters.length).toBeGreaterThan(0);
    expect(rafters.every((p) => p.cuts?.end?.name === 'plumb')).toBe(true);
  });
});
