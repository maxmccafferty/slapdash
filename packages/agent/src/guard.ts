/**
 * What the loop refuses before a tool runs: big changes without a plan, building after a
 * plan in the same turn, and calls beyond the per-turn caps. Refusals go back to Claude as
 * `is_error` tool results, as information (ADR-0002 §A7).
 *
 * ADR-0002 §F1 (confirm big changes) is enforced here as well as in the system prompt. A
 * call is "big" when it starts a structure (BIG_CHANGE_TOOLS) or when a dry run shows it
 * would bring the parts created this turn to BIG_CHANGE_PART_THRESHOLD or more. Big calls
 * run only when the person has turned the check off ("just do it"), when the previous turn
 * ended with a plan (the person has now answered it), or for undo, redo and restore.
 */
import { commandError, exposedCommands, type CommandBus, type CommandError } from '@slapdash/core';

export const BIG_CHANGE_PART_THRESHOLD = 50;

/** Builders that start a new structure: always a big change. */
export const BIG_CHANGE_TOOLS: ReadonlySet<string> = new Set(['pour_slab', 'frame_floor', 'build_roof', 'place_structure', 'build_fence']);

/** History tools that change the model but never need a plan. */
export const HISTORY_CHANGE_TOOLS: ReadonlySet<string> = new Set(['undo', 'redo', 'restore_version']);

/** Every tool that changes the model. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([...exposedCommands().map((d) => d.name), ...HISTORY_CHANGE_TOOLS]);

export const BIG_CHANGE_MESSAGE = 'This is a big change — show a one-line plan with propose_plan first. Nothing has changed yet.';

export interface TurnCaps {
  /** Tool calls per turn. Default 60. */
  maxToolCalls: number;
  /** Snapshots per turn. Default 3. */
  maxSnapshots: number;
  /** Requests to Claude (round trips) per turn. Default 30. */
  maxRequests: number;
}

export const DEFAULT_CAPS: Readonly<TurnCaps> = { maxToolCalls: 60, maxSnapshots: 3, maxRequests: 30 };

export interface TurnState {
  readonly caps: TurnCaps;
  /** The previous turn ended with a plan and the person has answered it. */
  readonly planApproved: boolean;
  planProposed: boolean;
  toolCalls: number;
  snapshots: number;
  requests: number;
  /** Parts created by commands so far this turn. */
  createdParts: number;
  /** The cap that was reached, if any. */
  capped: string | null;
}

export function newTurnState(caps: Partial<TurnCaps> = {}, planApproved = false): TurnState {
  return {
    caps: { ...DEFAULT_CAPS, ...caps },
    planApproved,
    planProposed: false,
    toolCalls: 0,
    snapshots: 0,
    requests: 0,
    createdParts: 0,
    capped: null,
  };
}

/** Part ids among created ids (assemblies have no "-"). */
export function countParts(created: readonly string[]): number {
  return created.filter((id) => id.includes('-')).length;
}

export function capMessage(what: string, limit: number): string {
  return `Turn limit reached: at most ${limit} ${what} per turn. Finish up now: tell the person what you did and what's left to do. Nothing else will run this turn.`;
}

const refuse = (message: string, hint?: string): CommandError => commandError('not_allowed', message, hint ? { hint } : {});

export interface GuardContext {
  bus: CommandBus;
  /** The project's big-change check (opt-in: true when the person asked for plans first). Read on every call. */
  confirmBigChanges: boolean;
  aborted?: boolean;
}

/**
 * Null when the call may run. Counts the call towards the caps when it passes them, so a
 * refused big change still counts as a call.
 */
export function checkCall(name: string, input: unknown, state: TurnState, ctx: GuardContext): CommandError | null {
  if (ctx.aborted) return refuse('Stopped: the person cancelled this turn. Nothing else will run this turn.');
  if (state.capped) return refuse(capMessage(state.capped, capLimit(state, state.capped)));
  if (state.toolCalls >= state.caps.maxToolCalls) {
    state.capped = 'tool calls';
    return refuse(capMessage('tool calls', state.caps.maxToolCalls));
  }
  if (name === 'snapshot' && state.snapshots >= state.caps.maxSnapshots) {
    state.capped = 'snapshots';
    return refuse(capMessage('snapshots', state.caps.maxSnapshots));
  }
  state.toolCalls++;
  if (name === 'snapshot') state.snapshots++;

  if (!MUTATING_TOOLS.has(name)) return null;
  if (state.planProposed) {
    return refuse(
      "You've shown a plan this turn, so this call did not run.",
      'End your turn and wait for the person to answer Build it or Change something.',
    );
  }
  if (HISTORY_CHANGE_TOOLS.has(name) || !ctx.confirmBigChanges || state.planApproved) return null;
  if (BIG_CHANGE_TOOLS.has(name)) return refuse(BIG_CHANGE_MESSAGE);
  const dry = ctx.bus.dryRun(name, input);
  if (dry.ok) {
    const total = state.createdParts + countParts(dry.created);
    if (total >= BIG_CHANGE_PART_THRESHOLD) {
      return refuse(`${BIG_CHANGE_MESSAGE} (It would bring the parts made this turn to ${total}.)`);
    }
  }
  return null;
}

function capLimit(state: TurnState, what: string): number {
  if (what === 'snapshots') return state.caps.maxSnapshots;
  if (what === 'requests to Claude') return state.caps.maxRequests;
  return state.caps.maxToolCalls;
}
