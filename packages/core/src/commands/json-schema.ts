/**
 * Tool definitions generated from the command schemas (ADR-0002 §A3), so the tools
 * Claude sees and the validation the bus runs can never drift apart.
 */
import { z } from 'zod';
import { historyToolDefs } from '../bus/history.ts';
import { exposedCommands } from './registry.ts';

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** JSON Schema for a command's *input* (before unit parsing), suitable for a tool definition. */
export function toInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Every exposed command plus the history tools, as `{ name, description, input_schema }`. */
export function commandJsonSchemas(): ToolSchema[] {
  return [
    ...exposedCommands().map((d) => ({ name: d.name, description: d.description, input_schema: toInputJsonSchema(d.schema) })),
    ...historyToolSchemas(),
  ];
}

/** The history tools (undo, redo, list_history, save_version, list_versions, restore_version). */
export function historyToolSchemas(): ToolSchema[] {
  return historyToolDefs.map((d) => ({ name: d.name, description: d.description, input_schema: toInputJsonSchema(d.schema) }));
}
