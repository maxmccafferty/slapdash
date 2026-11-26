import { commandJsonSchemas, exposedCommands } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES, agentTools, buildAgentTools } from '../src/index.ts';

describe('agent tools', () => {
  const tools = agentTools();

  it('are the exposed commands, the history tools, then the agent tools, in a fixed order', () => {
    expect(tools.map((t) => t.name)).toEqual([
      ...exposedCommands().map((d) => d.name),
      'undo',
      'redo',
      'list_history',
      'save_version',
      'list_versions',
      'restore_version',
      'find_parts',
      'get_part',
      'measure',
      'list_materials',
      'snapshot',
      'propose_plan',
      'request_photo',
      'set_preferences',
      'offer_options',
    ]);
    expect(tools.map((t) => t.name).slice(0, commandJsonSchemas().length)).toEqual(commandJsonSchemas().map((t) => t.name));
  });

  it('include the location and design-load overrides', () => {
    const names = tools.map((t) => t.name);
    for (const n of ['set_site_location', 'set_design_load', 'clear_design_load']) expect(names).toContain(n);
  });

  it('give every agent tool a strict input schema', () => {
    for (const name of AGENT_TOOL_NAMES) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.input_schema.type, name).toBe('object');
      expect(tool.input_schema.additionalProperties, name).toBe(false);
      expect(tool.description.length, name).toBeGreaterThan(40);
    }
  });

  it('take lengths as strings, so Claude never converts units', () => {
    const measure = tools.find((t) => t.name === 'measure')!;
    expect(JSON.stringify(measure.input_schema)).toContain('16ft 6in');
  });

  it('show id examples without quote marks, so Claude does not copy them into ids', () => {
    const descriptions = (node: unknown): string[] =>
      node && typeof node === 'object'
        ? Object.entries(node).flatMap(([k, v]) => (k === 'description' && typeof v === 'string' ? [v] : descriptions(v)))
        : [];
    for (const name of AGENT_TOOL_NAMES) {
      const ids = descriptions(tools.find((t) => t.name === name)!.input_schema).filter((d) => /\bids?\b|assembly/i.test(d));
      for (const d of ids) expect(d, name).not.toMatch(/(e\.g\.|\() *["“]/);
    }
    const measure = JSON.stringify(tools.find((t) => t.name === 'measure')!.input_schema);
    expect(measure).toContain('e.g. W1-S03 or W1.');
  });

  it('have unique names', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all stream their input eagerly', () => {
    for (const t of tools) expect(t.eager_input_streaming).toBe(true);
  });

  it('are byte-identical across calls and fresh builds, so the prompt cache holds', () => {
    expect(agentTools()).toBe(tools);
    expect(JSON.stringify(buildAgentTools())).toBe(JSON.stringify(tools));
    expect(JSON.stringify(buildAgentTools())).toBe(JSON.stringify(buildAgentTools()));
  });

  it('are deep-frozen', () => {
    expect(Object.isFrozen(tools)).toBe(true);
    expect(Object.isFrozen(tools[0])).toBe(true);
    expect(Object.isFrozen(tools[0]?.input_schema)).toBe(true);
  });
});
