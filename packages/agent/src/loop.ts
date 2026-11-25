/**
 * The agent loop (ADR-0002 §A1): one turn of the conversation. It runs in the browser and in
 * Node (evals) alike, with no DOM or Node APIs. Each turn:
 *
 * 1. adds the person's message, led by a `<project>` summary and any photos (wrapped as data);
 * 2. opens one undo group, so everything Claude does this turn is one undo step;
 * 3. asks Claude through the keyhole, runs the tools it calls (guard → dispatch), sends the
 *    results back, and repeats until Claude stops, a cap is reached or the turn is cancelled;
 * 4. closes the group and the turn, whatever happened, keeping the history valid.
 *
 * The caller persists `memory.toChatLog()` afterwards.
 */
import type { CommandBus, SiteDefaults } from '@slapdash/core';
import type { BudgetStatus, KeyholeDone } from './protocol.ts';
import type { KeyholeClient } from './client.ts';
import { dispatchTool, type PlanEvent } from './dispatch.ts';
import { capMessage, checkCall, newTurnState, type TurnCaps } from './guard.ts';
import type { AgentMemory, StoredBlock } from './memory.ts';
import { accumulateMessage } from './stream.ts';
import { projectSummary } from './summary.ts';
import type { SnapshotProvider } from './tools/snapshot.ts';
import { stressViewText, type AnalysisProvider, type StressContext } from './tools/structure.ts';

export interface AgentDeps {
  bus: CommandBus;
  client: KeyholeClient;
  memory: AgentMemory;
  snapshot?: SnapshotProvider;
  /** Runs the structural check for check_structure. */
  analysis?: AnalysisProvider;
  siteDefaults?: SiteDefaults;
  caps?: Partial<TurnCaps>;
  newTurnId?: () => string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface UserInput {
  text: string;
  /** Photos the person attached, stored as files. */
  photos?: { fileId: string; mimeType: string }[];
  /**
   * The answer to a pending plan: true for Build it, false for Change something. Left out,
   * any reply after a plan counts as an answer to it.
   */
  approvePlan?: boolean;
  /** The part the person tapped in the view before sending, so "this" can mean it. */
  pointedAt?: { id: string; label: string };
  /** Set on the automatic turn when the person turns the stress view on: what it shows. */
  stress?: StressContext;
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; content: StoredBlock[] }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; isError: boolean; content: string | StoredBlock[] }
  | { type: 'plan'; plan: PlanEvent }
  | { type: 'photo_request'; what: string }
  | { type: 'options'; options: string[] }
  | { type: 'budget'; budget: BudgetStatus }
  | { type: 'done'; done: KeyholeDone }
  | { type: 'error'; error: unknown };

export interface TurnResult {
  turnId: string;
  /** Everything Claude said this turn. */
  text: string;
  stopReason: string | null;
  /** The undo step this turn made, if it changed anything. */
  historyEntryId: number | null;
  plan: PlanEvent | null;
  photoRequest: string | null;
  /** Choices Claude offered when it couldn't do what was asked. */
  options: string[] | null;
  /** What the requests this turn cost, in dollars. */
  costUsd: number;
  budget: BudgetStatus | null;
  toolCalls: number;
  /** Tool calls refused by the guard or by the tool itself. */
  refusals: number;
  /** The cap that ended the turn, if any. */
  capped: string | null;
  /** Short notes for the chat, e.g. when Claude's reply was cut off. */
  notes: string[];
  aborted: boolean;
}

let turnCounter = 0;
const defaultTurnId = () => `turn-${Date.now().toString(36)}-${++turnCounter}`;

function textOf(content: readonly StoredBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

export async function runTurn(deps: AgentDeps, input: UserInput): Promise<TurnResult> {
  const { bus, client, memory, signal } = deps;
  const emit = (e: AgentEvent) => deps.onEvent?.(e);
  const turnId = (deps.newTurnId ?? defaultTurnId)();

  // A plan from the previous turn is approved by any answer except "Change something".
  const pendingPlan = memory.pendingPlan;
  const approved = (pendingPlan !== null && input.approvePlan !== false) || input.approvePlan === true;
  const state = newTurnState(deps.caps, approved);

  const summary = projectSummary(bus.project, {
    ...(deps.siteDefaults ? { siteDefaults: deps.siteDefaults } : {}),
    versions: bus.listVersions().map((v) => v.name),
    pendingPlan,
    confirmBigChanges: memory.prefs.confirmBigChanges,
  });
  const userContent: StoredBlock[] = [{ type: 'slapdash_project', text: summary }];
  for (const photo of input.photos ?? []) userContent.push({ type: 'slapdash_file', fileId: photo.fileId, mimeType: photo.mimeType, kind: 'photo' });
  if (input.stress) userContent.push({ type: 'slapdash_stress', text: stressViewText(input.stress) });
  if (input.pointedAt) userContent.push({ type: 'slapdash_pointer', partId: input.pointedAt.id, label: input.pointedAt.label });
  userContent.push({ type: 'text', text: input.text.trim() === '' ? '(no text)' : input.text });
  memory.beginTurn(turnId, userContent);

  const result: TurnResult = {
    turnId,
    text: '',
    stopReason: null,
    historyEntryId: null,
    plan: null,
    photoRequest: null,
    options: null,
    costUsd: 0,
    budget: null,
    toolCalls: 0,
    refusals: 0,
    capped: null,
    notes: [],
    aborted: false,
  };
  const changes: string[] = [];
  const said: string[] = [];

  bus.beginGroup({ label: `Claude: ${input.text.trim().slice(0, 60)}`, source: 'claude', turnId });
  try {
    let wrapUpSent = false;
    while (true) {
      if (signal?.aborted) {
        result.aborted = true;
        break;
      }
      state.requests++;
      const reply = await accumulateMessage(client(await memory.toApiMessages(), signal), {
        onTextDelta: (text) => emit({ type: 'text_delta', text }),
        onBudget: (budget) => emit({ type: 'budget', budget }),
      });
      if (reply.done) {
        result.costUsd += reply.done.costUsd;
        emit({ type: 'done', done: reply.done });
      }
      result.budget = reply.budget ?? result.budget;
      result.stopReason = reply.stopReason;

      const content = reply.message.content as unknown as StoredBlock[];
      if (content.length > 0) {
        memory.append('assistant', content);
        emit({ type: 'assistant_message', content });
      }
      const text = textOf(content);
      if (text.trim() !== '') said.push(text);

      if (reply.stopReason !== 'tool_use') {
        if (reply.stopReason === 'max_tokens') result.notes.push("Claude's reply hit the length limit and was cut short.");
        if (reply.stopReason === 'refusal') result.notes.push('Claude declined to continue with this request.');
        break;
      }

      const results: StoredBlock[] = [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const call = { id: String(block.id), name: String(block.name), input: block.input };
        emit({ type: 'tool_start', ...call });
        const refusal = checkCall(call.name, call.input, state, {
          bus,
          confirmBigChanges: memory.prefs.confirmBigChanges,
          aborted: signal?.aborted ?? false,
        });
        let outcome;
        if (refusal) {
          outcome = { content: refusal.hint ? `${refusal.message} ${refusal.hint}` : refusal.message, isError: true, effects: {} };
        } else {
          outcome = await dispatchTool(call, {
            bus,
            memory,
            ...(deps.snapshot ? { snapshot: deps.snapshot } : {}),
            ...(deps.analysis ? { analysis: deps.analysis } : {}),
          });
          const fx = outcome.effects;
          if (fx.created) state.createdParts += fx.created.filter((id) => id.includes('-')).length;
          if (fx.changeSummary) changes.push(fx.changeSummary);
          if (fx.plan) {
            state.planProposed = true;
            result.plan = fx.plan;
            emit({ type: 'plan', plan: fx.plan });
          }
          if (fx.photoRequest) {
            result.photoRequest = fx.photoRequest;
            emit({ type: 'photo_request', what: fx.photoRequest });
          }
          if (fx.options) {
            result.options = fx.options;
            emit({ type: 'options', options: fx.options });
          }
        }
        if (outcome.isError) result.refusals++;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
        emit({ type: 'tool_result', id: call.id, name: call.name, isError: outcome.isError, content: outcome.content });
      }

      if (signal?.aborted) {
        memory.append('user', results);
        result.aborted = true;
        break;
      }
      // Leave room for one last request to wrap up when the round trips run out.
      if (!state.capped && state.requests + 1 >= state.caps.maxRequests) {
        state.capped = 'requests to Claude';
        results.push({ type: 'text', text: capMessage('requests to Claude', state.caps.maxRequests) });
      }
      memory.append('user', results);
      if (state.capped) {
        if (wrapUpSent) break;
        wrapUpSent = true;
      }
    }
  } catch (error) {
    emit({ type: 'error', error });
    throw error;
  } finally {
    // Keep the history valid for the next turn: every tool_use gets a result.
    const open = memory.unansweredToolUses();
    if (open.length > 0) {
      memory.append(
        'user',
        open.map((t) => ({ type: 'tool_result', tool_use_id: t.id, content: `Stopped: ${t.name} did not run because the turn ended.`, is_error: true })),
      );
    }
    const entry = bus.endGroup();
    result.historyEntryId = entry?.id ?? null;
    result.toolCalls = state.toolCalls;
    result.capped = state.capped;
    result.text = said.join('\n\n');
    memory.endTurn({ asked: input.text, changeSummaries: changes, plan: result.plan?.text ?? null });
  }
  return result;
}

