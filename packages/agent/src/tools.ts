/**
 * The tool list Claude sees (ADR-0002 §A3, §A5). It is generated from the command schemas,
 * so the tools and the bus's validation can never drift apart. The list is prompt-cached,
 * so it must be byte-stable: fixed order, no generated values.
 *
 * Later tickets (snapshot, find_parts, get_part, measure) append their tools here.
 */
import { commandJsonSchemas } from '@slapdash/core';

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
  /**
   * Stream tool input as it is generated. The API then no longer validates the input,
   * which is fine: the browser bus validates every tool input with Zod before running it.
   */
  readonly eager_input_streaming: true;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Builds a fresh tool list. Use `agentTools()`; this exists so tests can check stability. */
export function buildAgentTools(): readonly AgentTool[] {
  return commandJsonSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    eager_input_streaming: true as const,
  }));
}

let cached: readonly AgentTool[] | undefined;

/** The tool list, deep-frozen and memoised so every request sends identical bytes. */
export function agentTools(): readonly AgentTool[] {
  cached ??= deepFreeze(buildAgentTools());
  return cached;
}
