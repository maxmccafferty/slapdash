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

  it('matches a fresh build byte for byte', () => {
    expect(shipped === buildSampleText(), 'src/samples/pool-house.slapdash is out of date: run pnpm --filter @slapdash/web sample').toBe(true);
  });
});
