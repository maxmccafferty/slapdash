import { describe, expect, it } from 'vitest';
import { commandJsonSchemas, commandRegistry, zId } from '../../src/index.ts';
import { fixtureProject, runErr, runOk } from '../helpers.ts';

// Claude sometimes sends IDs with the quote marks inside the string: the JSON
// value "\"W3\"" arrives as "W3" with its quotes.

describe('zId', () => {
  it.each([
    ['W3', 'W3'],
    ['"W3"', 'W3'],
    ['“W1-S03”', 'W1-S03'],
    ['  "R1"  ', 'R1'],
    [' W1 ', 'W1'],
    [JSON.parse('"\\"W1-S03\\""') as string, 'W1-S03'],
  ])('%j → %j', (input, expected) => {
    expect(zId.parse(input)).toBe(expected);
  });

  it('rejects blanks, including empty quotes', () => {
    for (const s of ['', '  ', '""']) expect(zId.safeParse(s).success).toBe(false);
  });

  it('leaves a quote on one side alone', () => {
    expect(zId.parse('"W3')).toBe('"W3');
  });
});

describe('quoted IDs in commands', () => {
  it('add_part resolves a quoted assembly, material and section, and accepts a quoted explicit ID', () => {
    const res = runOk(fixtureProject(), 'add_part', {
      assemblyId: '"W1"',
      role: 'stud',
      materialId: '“spf-no2”',
      sectionId: '"2x4"',
      position: { x: '32in', y: 38.1, z: 0 },
      length: '92 5/8in',
      id: '"W1-S03"',
    });
    expect(res.created).toEqual(['W1-S03']);
    expect(res.project.parts['W1-S03']).toMatchObject({ assemblyId: 'W1', materialId: 'spf-no2', sectionId: '2x4' });
  });

  it('update_part, delete_parts and update_assembly resolve quoted IDs', () => {
    const p = fixtureProject();
    expect(runOk(p, 'update_part', { id: '"W1-S01"', name: 'King stud' }).project.parts['W1-S01']!.name).toBe('King stud');
    expect(runOk(p, 'delete_parts', { ids: ['"W1-S01"', '“W1-S02”'] }).project.parts['W1-S01']).toBeUndefined();
    expect(runOk(p, 'update_assembly', { id: '"W1"', name: 'North wall' }).project.assemblies['W1']!.name).toBe('North wall');
  });

  it('an unknown quoted ID is reported without the quotes', () => {
    const [e] = runErr(fixtureProject(), 'update_part', { id: '"W9-S01"', name: 'x' });
    expect(e!.message).toContain('"W9-S01"');
    expect(e!.message).not.toContain('""W9-S01""');
  });

  it('connect reads quoted part IDs', () => {
    const parsed = commandRegistry.get('connect')!.schema.parse({
      jointTypeId: '"nailed-16d"',
      partIds: ['"W1-S01"', '“GROUND”'],
      at: { x: 0, y: 0, z: 0 },
    }) as { jointTypeId: string; partIds: [string, string] };
    expect(parsed.jointTypeId).toBe('nailed-16d');
    expect(parsed.partIds).toEqual(['W1-S01', 'GROUND']);
  });
});

describe('ID fields in the tool schemas', () => {
  it('stay plain strings, and their descriptions do not quote example IDs', () => {
    const schemas = commandJsonSchemas();
    const addPart = schemas.find((t) => t.name === 'add_part')!.input_schema as {
      properties: Record<string, { type?: unknown; description?: string }>;
    };
    expect(addPart.properties.assemblyId).toMatchObject({ type: 'string', description: 'Assembly to add to, e.g. W2.' });
    expect(addPart.properties.id!.description).toBe('Explicit ID like W2-S07. Usually left out so one is chosen.');
    const json = JSON.stringify(schemas);
    for (const id of ['W2', 'W3', 'W2-S07', 'J0012', '2x4', 'spf-no2', 'GROUND', 'L0']) {
      expect(json, id).not.toContain(`\\"${id}\\"`);
    }
  });
});
