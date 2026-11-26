import { describe, expect, it } from 'vitest';
import { commandJsonSchemas, exposedCommands, historyToolSchemas } from '../src/index.ts';

describe('JSON Schema export', () => {
  const tools = commandJsonSchemas();

  it('covers every exposed command and every history tool, and no internal ones', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      ...exposedCommands().map((d) => d.name),
      'undo',
      'redo',
      'list_history',
      'save_version',
      'list_versions',
      'restore_version',
    ]);
    for (const internal of ['put_entities', 'remove_entities', 'set_site', 'set_prices', 'replace_project']) {
      expect(names).not.toContain(internal);
    }
    expect(historyToolSchemas()).toHaveLength(6);
  });

  it('names are unique snake_case and descriptions are non-empty', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(t.description.trim().length).toBeGreaterThan(10);
    }
  });

  it('every input schema is a closed object', () => {
    for (const t of tools) {
      expect(t.input_schema.type, t.name).toBe('object');
      expect(t.input_schema.additionalProperties, t.name).toBe(false);
      expect(t.input_schema).not.toHaveProperty('$schema');
      expect(JSON.stringify(t.input_schema)).not.toContain('unrepresentable');
    }
  });

  it('length fields advertise number | string with a description', () => {
    const addPart = tools.find((t) => t.name === 'add_part')!.input_schema as {
      properties: Record<string, { type?: unknown; description?: string; properties?: Record<string, { type?: unknown }> }>;
      required: string[];
    };
    for (const key of ['length', 'width', 'height']) {
      expect(addPart.properties[key]!.type).toEqual(['number', 'string']);
      expect(addPart.properties[key]!.description).toMatch(/16ft 6in|8ft/);
    }
    expect(addPart.properties.position!.properties!.y!.type).toEqual(['number', 'string']);
    expect(addPart.required).toEqual(['assemblyId', 'role', 'materialId', 'position', 'length']);
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(tools))).toEqual(tools);
  });
});
