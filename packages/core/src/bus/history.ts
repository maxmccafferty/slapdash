import { z } from 'zod';
import { zId } from '../commands/common.ts';
import type { AppliedCommand } from '../commands/types.ts';

export type HistorySource = 'claude' | 'user' | 'system';

export interface GroupMeta {
  label: string;
  source: HistorySource;
  /** The Claude turn this group belongs to (one turn = one undo group, ADR-0002 §A2). */
  turnId?: string;
}

export interface RecordedCommand {
  redo: AppliedCommand;
  inverse: AppliedCommand[];
  summary: string;
}

/** One undo step: a single command, or everything a group (e.g. a Claude turn) did. */
export interface HistoryEntry extends GroupMeta {
  id: number;
  /** When the entry was committed (ms since epoch). */
  at: number;
  commands: RecordedCommand[];
}

export interface HistoryListItem {
  id: number;
  label: string;
  source: HistorySource;
  turnId?: string;
  at: number;
  summaries: string[];
  /** True if this entry has been undone and can be redone. */
  isUndone: boolean;
}

export const DEFAULT_HISTORY_LIMIT = 500;

/**
 * History operations are bus methods, not registry commands, but Claude calls them as
 * tools (ADR-0002 §A8). Their input schemas live here so `packages/agent` can generate
 * those tools alongside the command tools.
 */
export const historyToolDefs = [
  {
    name: 'undo',
    description: 'Undo the most recent change (a whole turn of changes counts as one).',
    schema: z.strictObject({}),
  },
  {
    name: 'redo',
    description: 'Redo the change most recently undone.',
    schema: z.strictObject({}),
  },
  {
    name: 'list_history',
    description: 'List recent changes, oldest first, including ones that were undone and can be redone.',
    schema: z.strictObject({
      limit: z.number().int().min(1).max(200).optional().describe('How many recent entries to list. Default 20.'),
    }),
  },
  {
    name: 'save_version',
    description: 'Save a named copy of the project as it is now, to come back to later.',
    schema: z.strictObject({
      name: zId.describe('A unique name, e.g. before roof.'),
      note: z.string().optional().describe('Optional note about this version.'),
    }),
  },
  {
    name: 'list_versions',
    description: 'List the saved versions.',
    schema: z.strictObject({}),
  },
  {
    name: 'restore_version',
    description: 'Restore a saved version. The restore can itself be undone.',
    schema: z.strictObject({
      name: zId.describe('Name of the saved version.'),
    }),
  },
] as const;
