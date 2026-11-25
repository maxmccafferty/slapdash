import { describe, expect, it } from 'vitest';
import { displayText, emptyClaudeItem, paragraphs, type ChatItem, type ClaudeItem } from '../../src/agent/chat-types.ts';
import { fetchKeyholeStatus } from '../../src/agent/keyhole-status.ts';
import { createPhotoStore } from '../../src/agent/photos.ts';
import { formatResetDate, warningNote } from '../../src/agent/chat-controller.ts';
import { addNote, answerPending, appendDelta, commitAssistant, finishTurn } from '../../src/state/chat-store.ts';
import { BUDGET } from './harness.tsx';

const claude = (over: Partial<ClaudeItem> = {}): ClaudeItem => ({ ...emptyClaudeItem('c1'), ...over });

describe('chat store updaters', () => {
  it('append deltas and commit whole messages', () => {
    let items: ChatItem[] = [claude()];
    items = appendDelta(items, 'c1', 'Walls ');
    items = appendDelta(items, 'c1', 'are up.');
    expect((items[0] as ClaudeItem).text).toBe('Walls are up.');
    items = commitAssistant(items, 'c1', ['One.', 'Two.']);
    expect((items[0] as ClaudeItem).text).toBe('One.\n\nTwo.');
  });

  it('finishTurn adds Undo, notes and "nothing changed" only for options without a change', () => {
    const withOptions = claude({ text: 'No. Nothing has changed yet.', options: { choices: ['a', 'b'], state: 'pending' } });
    const [done] = finishTurn([withOptions], 'c1', { historyEntryId: null, notes: ['Cut short.'] }) as ClaudeItem[];
    expect(done!.streaming).toBe(false);
    expect(done!.nothingChanged).toBe(true);
    expect(done!.notes).toEqual(['Cut short.']);
    expect(displayText(done!)).toBe('No.');
    const [changed] = finishTurn([claude({ text: 'Done.' })], 'c1', { historyEntryId: 4, notes: [] }) as ClaudeItem[];
    expect(changed!.undo).toEqual({ entryId: 4, state: 'available' });
    expect(changed!.nothingChanged).toBe(false);
  });

  it('finishTurn drops a turn that ended with nothing to show', () => {
    expect(finishTurn([claude()], 'c1', { historyEntryId: null, notes: [] })).toEqual([]);
  });

  it('answerPending answers plans, photo requests and options', () => {
    const items = answerPending(
      [claude({ plan: { text: 'p', state: 'pending' }, photoRequest: { what: 'w', state: 'pending' }, options: { choices: ['a', 'b'], state: 'pending' } })],
      'changing',
    ) as ClaudeItem[];
    expect(items[0]!.plan!.state).toBe('changing');
    expect(items[0]!.photoRequest!.state).toBe('answered');
    expect(items[0]!.options!.state).toBe('answered');
  });

  it('addNote appends a muted note', () => {
    expect(addNote([], 'Stopped.')).toMatchObject([{ kind: 'note', tone: 'muted', text: 'Stopped.' }]);
  });

  it('paragraphs split on blank lines', () => {
    expect(paragraphs('One.\n\n\nTwo\nlines.\n')).toEqual(['One.', 'Two\nlines.']);
  });
});

describe('chat copy', () => {
  it('reads the reset date in UTC and the warning in dollars', () => {
    expect(formatResetDate('2026-12-01T00:00:00.000Z')).toBe('December 1');
    expect(warningNote({ ...BUDGET, spentUsd: 8, fraction: 0.8 })).toBe("80% of this month's Claude budget is used: $8.00 of $10.00.");
  });
});

describe('keyhole status', () => {
  it('reads a status, and is null for a missing keyhole or a non-JSON answer', async () => {
    const status = { configured: true, model: 'm', budget: BUDGET };
    expect(await fetchKeyholeStatus(async () => ({ ok: true, json: async () => status }))).toEqual(status);
    expect(await fetchKeyholeStatus(async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await fetchKeyholeStatus(async () => ({ ok: true, json: async () => Promise.reject(new SyntaxError('html')) }))).toBeNull();
    expect(await fetchKeyholeStatus(async () => Promise.reject(new TypeError('offline')))).toBeNull();
  });
});

describe('photo store', () => {
  it('keeps photos as base64 for loadFile and revokes their URLs', async () => {
    const revoked: string[] = [];
    const store = createPhotoStore({ createUrl: () => 'blob:1', revokeUrl: (u) => revoked.push(u) });
    const p = await store.put({ blob: new Blob([new Uint8Array([1, 2, 3])]), mimeType: 'image/jpeg' });
    expect(await store.loadFile(p.fileId)).toEqual({ data: 'AQID', mediaType: 'image/jpeg' });
    store.remove(p.fileId);
    expect(await store.loadFile(p.fileId)).toBeNull();
    expect(revoked).toEqual(['blob:1']);
  });
});
