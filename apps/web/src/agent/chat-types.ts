/**
 * What the chat transcript shows. Items are UI state, not the conversation Claude sees: that
 * lives in the agent's `AgentMemory`. Each Claude turn is one `claude` item that streams in,
 * then gains its Undo key, plan card, photo request or option keys.
 */
export interface PointerChip {
  id: string;
  label: string;
  /** The part's material swatch colour, if the catalog has one. */
  swatch: { color: string } | null;
}

export interface ChatPhoto {
  fileId: string;
  /** An object URL for the thumbnail. */
  url: string;
  mimeType: string;
}

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  pointer?: PointerChip;
  photos: ChatPhoto[];
  /** Sent by the app, not typed: "stress" is the automatic turn when Stress is switched on. */
  trigger?: 'stress';
}

export type UndoState = 'available' | 'undone';
export type PlanState = 'pending' | 'approved' | 'changing';
export type AnswerState = 'pending' | 'answered';

export interface ClaudeItem {
  kind: 'claude';
  id: string;
  turnId: string | null;
  text: string;
  streaming: boolean;
  /** The undo step this turn made. */
  undo: { entryId: number; state: UndoState } | null;
  plan: { text: string; state: PlanState } | null;
  photoRequest: { what: string; state: AnswerState } | null;
  options: { choices: string[]; state: AnswerState; chosen?: string } | null;
  /** The turn offered options and changed nothing: "Nothing has changed yet." under the keys. */
  nothingChanged: boolean;
  notes: string[];
}

export interface NoteItem {
  kind: 'note';
  id: string;
  tone: 'muted';
  text: string;
}

export type ChatItem = UserItem | ClaudeItem | NoteItem;

/** Where the chat stands with the keyhole. */
export type Connection = 'checking' | 'ready' | 'not_configured' | 'capped';

export const NOTHING_CHANGED = 'Nothing has changed yet.';

export function emptyClaudeItem(id: string, turnId: string | null = null): ClaudeItem {
  return { kind: 'claude', id, turnId, text: '', streaming: true, undo: null, plan: null, photoRequest: null, options: null, nothingChanged: false, notes: [] };
}

/** The message text as shown: a trailing "Nothing has changed yet." is dropped when the UI shows it under the keys. */
export function displayText(item: ClaudeItem): string {
  if (!item.nothingChanged) return item.text;
  const trimmed = item.text.trimEnd();
  return trimmed.endsWith(NOTHING_CHANGED) ? trimmed.slice(0, -NOTHING_CHANGED.length).trimEnd() : item.text;
}

/** Paragraphs split on blank lines. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}
