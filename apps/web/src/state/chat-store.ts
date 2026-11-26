/**
 * The chat's UI state. It lives outside React (like the model store) so the transcript and a
 * running turn survive the phone sheet closing, which unmounts the panel, and crossing the
 * breakpoint. `chat-controller.ts` is the only writer besides the draft.
 */
import { create } from 'zustand';
import type { BudgetStatus } from '@slapdash/agent';
import type { ChatItem, ChatPhoto, ClaudeItem, Connection } from '../agent/chat-types.ts';

export interface ChatState {
  connection: Connection;
  budget: BudgetStatus | null;
  /** The 80% note has been shown this session. */
  warned: boolean;
  items: ChatItem[];
  /** The turn in flight. `working`: Claude is running tools, not talking. */
  running: { turnId: string | null; itemId: string; working: boolean } | null;
  draft: string;
  /** Photos picked for a pending photo request; they go with the next message. */
  pendingPhotos: ChatPhoto[];
  /** The person pressed Change something: the next message answers the plan with false. */
  changingPlan: boolean;
  /** Bumped to move focus to the message field. */
  focusRequest: number;
  /** What this browser can do. Talk is hidden when `listen` is false. */
  voice: { listen: boolean; speak: boolean };
  /** Hold-to-talk in progress: confirmed words and the unconfirmed tail. */
  listening: { heard: string; unconfirmed: string } | null;
  /** Claude's reply is being read aloud. */
  speaking: boolean;
}

export interface ChatStoreActions {
  setDraft: (draft: string) => void;
}

export const initialChatState: ChatState = {
  connection: 'checking',
  budget: null,
  warned: false,
  items: [],
  running: null,
  draft: '',
  pendingPhotos: [],
  changingPlan: false,
  focusRequest: 0,
  voice: { listen: false, speak: false },
  listening: null,
  speaking: false,
};

export const useChatStore = create<ChatState & ChatStoreActions>()((set) => ({
  ...initialChatState,
  setDraft: (draft) => set({ draft }),
}));

/** Back to the initial state (tests). */
export function resetChatStore(): void {
  useChatStore.setState(initialChatState);
}

// ── Pure updaters ───────────────────────────────────────────────────────────

export function updateItem<K extends ChatItem['kind']>(
  items: readonly ChatItem[],
  id: string,
  kind: K,
  fn: (item: Extract<ChatItem, { kind: K }>) => Extract<ChatItem, { kind: K }>,
): ChatItem[] {
  return items.map((item) => (item.id === id && item.kind === kind ? fn(item as Extract<ChatItem, { kind: K }>) : item));
}

export function updateClaude(items: readonly ChatItem[], id: string, fn: (item: ClaudeItem) => ClaudeItem): ChatItem[] {
  return updateItem(items, id, 'claude', fn);
}

export function appendDelta(items: readonly ChatItem[], id: string, text: string): ChatItem[] {
  return updateClaude(items, id, (item) => ({ ...item, text: item.text + text }));
}

/** Each assistant message's text, joined the way the loop joins them. */
export function commitAssistant(items: readonly ChatItem[], id: string, said: readonly string[]): ChatItem[] {
  return updateClaude(items, id, (item) => ({ ...item, text: said.join('\n\n') }));
}

export interface TurnEnd {
  historyEntryId: number | null;
  notes: readonly string[];
}

/** The turn is over: stop streaming, add Undo and notes; drop the item if it ended empty. */
export function finishTurn(items: readonly ChatItem[], id: string, end: TurnEnd): ChatItem[] {
  const out = updateClaude(items, id, (item) => ({
    ...item,
    streaming: false,
    undo: end.historyEntryId !== null ? { entryId: end.historyEntryId, state: 'available' } : null,
    nothingChanged: item.options !== null && end.historyEntryId === null,
    notes: [...item.notes, ...end.notes],
  }));
  return out.filter(
    (item) =>
      !(item.id === id && item.kind === 'claude' && item.text.trim() === '' && !item.undo && !item.plan && !item.photoRequest && !item.options && item.notes.length === 0),
  );
}

let noteCounter = 0;
export function addNote(items: readonly ChatItem[], text: string): ChatItem[] {
  return [...items, { kind: 'note', id: `note-${++noteCounter}`, tone: 'muted', text }];
}

/** Mark every pending plan, photo request and option set as answered. */
export function answerPending(items: readonly ChatItem[], plan: 'approved' | 'changing' | null): ChatItem[] {
  return items.map((item) => {
    if (item.kind !== 'claude') return item;
    let next = item;
    if (item.plan && (item.plan.state === 'pending' || item.plan.state === 'changing')) {
      next = { ...next, plan: { ...item.plan, state: plan ?? 'approved' } };
    }
    if (item.photoRequest?.state === 'pending') next = { ...next, photoRequest: { ...item.photoRequest, state: 'answered' } };
    if (item.options?.state === 'pending') next = { ...next, options: { ...item.options, state: 'answered' } };
    return next;
  });
}
