import { commandJsonSchemas, exposedCommands } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import { agentTools, buildAgentTools } from '../src/index.ts';

describe('agent tools', () => {
  const tools = agentTools();

  it('are the exposed commands plus the history tools, in a fixed order', () => {
    expect(tools.map((t) => t.name)).toEqual([
      ...exposedCommands().map((d) => d.name),
      'undo',
      'redo',
      'list_history',
      'save_version',
      'list_versions',
      'restore_version',
    ]);
    expect(tools.map((t) => t.name)).toEqual(commandJsonSchemas().map((t) => t.name));
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
