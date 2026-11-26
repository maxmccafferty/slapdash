import { zChatLog, type ChatLog } from '@slapdash/storage';
import { describe, expect, it } from 'vitest';
import { AgentMemory, PHOTO_STUB, PHOTO_WRAPPER, PROJECT_STUB, snapshotStub, type ChatLogLike, type StoredBlock } from '../src/index.ts';
import { expectValidMessages } from './helpers.ts';

interface TurnOpts {
  tool?: boolean;
  snapshot?: boolean;
  photo?: boolean;
  plan?: string;
}

function turn(mem: AgentMemory, id: string, text: string, opts: TurnOpts = {}) {
  const content: StoredBlock[] = [{ type: 'slapdash_project', text: `<project>\n${id}\n</project>` }];
  if (opts.photo) content.push({ type: 'slapdash_file', fileId: `f-${id}`, mimeType: 'image/jpeg', kind: 'photo' });
  content.push({ type: 'text', text });
  mem.beginTurn(id, content);
  if (opts.tool || opts.snapshot) {
    const name = opts.snapshot ? 'snapshot' : 'build_wall';
    mem.append('assistant', [
      { type: 'text', text: 'On it.' },
      { type: 'tool_use', id: `tu-${id}`, name, input: {} },
    ]);
    const result = opts.snapshot
      ? [
          { type: 'slapdash_snapshot', label: 'top view, textured, 768px', image: { media_type: 'image/png', data: `PNG-${id}` } },
          { type: 'text', text: 'Snapshot: top view.' },
        ]
      : 'Built wall W1.';
    mem.append('user', [{ type: 'tool_result', tool_use_id: `tu-${id}`, content: result }]);
  }
  mem.append('assistant', [{ type: 'text', text: `Done with ${id}.` }]);
  mem.endTurn({ asked: text, changeSummaries: opts.tool ? [`Built wall W1 "North wall": 20' 0" long. With 16 studs.`] : [], plan: opts.plan ?? null });
}

type Block = { type: string; text?: string; content?: unknown; source?: { data: string } };
const blocks = (m: { content?: unknown }) => (typeof m.content === 'string' ? [] : (m.content as Block[]));
const texts = (msgs: { content?: unknown }[]) =>
  msgs.flatMap((m) => blocks(m).flatMap((b) => (b.type === 'tool_result' && Array.isArray(b.content) ? (b.content as Block[]) : [b]))).filter((b) => b.type === 'text').map((b) => b.text!);

describe('agent memory', () => {
  it('builds valid messages without our own block types', async () => {
    const mem = new AgentMemory();
    turn(mem, 't1', 'Build a wall', { tool: true });
    turn(mem, 't2', 'Thanks');
    const msgs = await mem.toApiMessages();
    expectValidMessages(msgs);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  });

  it('folds whole turns beyond maxTurns into summary lines, keeping tool_use with its tool_result', async () => {
    const mem = new AgentMemory(undefined, { maxTurns: 3 });
    for (let i = 1; i <= 5; i++) turn(mem, `t${i}`, `Request number ${i}`, { tool: i % 2 === 1 });
    expect(mem.turnCount).toBe(3);
    expect(mem.summary).toBe(
      [
        '- Asked: "Request number 1". Did: Built wall W1 "North wall": 20\' 0" long. Said: "Done with t1."',
        '- Asked: "Request number 2". Did: nothing. Said: "Done with t2."',
      ].join('\n'),
    );
    const msgs = await mem.toApiMessages();
    expectValidMessages(msgs);
    expect(blocks(msgs[0]!)[0]!.text).toBe(`<earlier_conversation>\n${mem.summary}\n</earlier_conversation>`);
    const kept = texts(msgs).slice(1);
    expect(kept).not.toContain('Request number 2');
    expect(kept).toContain('Request number 3');
  });

  it('folds by size too, but never the latest turn, and caps the summary', () => {
    const mem = new AgentMemory(undefined, { maxChars: 1500, maxSummaryChars: 300 });
    for (let i = 1; i <= 6; i++) turn(mem, `t${i}`, `Request ${i} ${'x'.repeat(400)}`);
    expect(mem.turnCount).toBeLessThan(6);
    expect(mem.turnCount).toBeGreaterThanOrEqual(1);
    expect(mem.summary!.length).toBeLessThanOrEqual(300);
    expect(mem.summary!.split('\n').at(-1)).toMatch(/^- Asked: "Request \d/);
    const big = new AgentMemory(undefined, { maxChars: 10 });
    turn(big, 'only', 'y'.repeat(500));
    expect(big.turnCount).toBe(1);
  });

  it('keeps snapshots for their turn and the next, then stubs them', async () => {
    const mem = new AgentMemory();
    turn(mem, 't1', 'Look at it', { snapshot: true });
    let msgs = await mem.toApiMessages();
    expect(JSON.stringify(msgs)).toContain('"data":"PNG-t1"');
    turn(mem, 't2', 'And now?');
    msgs = await mem.toApiMessages();
    expect(JSON.stringify(msgs)).toContain('"data":"PNG-t1"');
    turn(mem, 't3', 'Ok');
    msgs = await mem.toApiMessages();
    expect(JSON.stringify(msgs)).not.toContain('PNG-t1');
    expect(texts(msgs)).toContain(snapshotStub('top view, textured, 768px'));
    expect(snapshotStub('top view, textured, 768px')).toBe(
      '[Snapshot from an earlier turn: top view, textured, 768px — removed to save space. Take a new one if you need to look again.]',
    );
    expectValidMessages(msgs);
  });

  it('resolves recent photos through loadFile, wrapped as data, and stubs them later', async () => {
    const loaded: string[] = [];
    const mem = new AgentMemory(undefined, {
      loadFile: async (id) => {
        loaded.push(id);
        return { data: `JPEG-${id}`, mediaType: 'image/jpeg' };
      },
    });
    turn(mem, 't1', 'Here is my yard', { photo: true });
    let msgs = await mem.toApiMessages();
    const first = blocks(msgs[0]!);
    expect(first.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text']);
    expect(first[1]!.text).toBe(PHOTO_WRAPPER);
    expect(first[2]!.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'JPEG-f-t1' });
    expect(loaded).toEqual(['f-t1']);
    turn(mem, 't2', 'next');
    turn(mem, 't3', 'later');
    msgs = await mem.toApiMessages();
    expect(blocks(msgs[0]!).map((b) => b.text)).toEqual([PROJECT_STUB, PHOTO_WRAPPER, PHOTO_STUB, 'Here is my yard']);
  });

  it('stubs project summaries older than the image window, and never rewrites recent ones', async () => {
    const mem = new AgentMemory();
    turn(mem, 't1', 'a');
    turn(mem, 't2', 'b');
    const before = await mem.toApiMessages();
    expect(texts(before)).toContain('<project>\nt1\n</project>');
    turn(mem, 't3', 'c');
    const after = await mem.toApiMessages();
    expect(texts(after)).not.toContain('<project>\nt1\n</project>');
    expect(texts(after)).toContain(PROJECT_STUB);
    expect(texts(after)).toContain('<project>\nt2\n</project>');
    expect(texts(after)).toContain('<project>\nt3\n</project>');
  });

  it('saves a chat log storage accepts, without snapshot bytes, and restores prefs and the pending plan', async () => {
    const mem = new AgentMemory(undefined, { now: () => 7 });
    mem.setPrefs({ confirmBigChanges: false });
    turn(mem, 't1', 'Look', { snapshot: true });
    turn(mem, 't2', 'Build a shed', { plan: "I'll build an 8×10 shed." });
    expect(mem.pendingPlan).toBe("I'll build an 8×10 shed.");
    const log: ChatLog = mem.toChatLog();
    expect(zChatLog.safeParse(log).success).toBe(true);
    expect(JSON.stringify(log)).not.toContain('PNG-t1');
    expect(log.prefs).toEqual({ confirmBigChanges: false });

    const back = new AgentMemory(log satisfies ChatLogLike);
    expect(back.prefs).toEqual({ confirmBigChanges: false });
    expect(back.pendingPlan).toBe("I'll build an 8×10 shed.");
    const msgs = await back.toApiMessages();
    expect(texts(msgs)).toContain(snapshotStub('top view, textured, 768px'));
    expectValidMessages(msgs);
  });

  it('defaults to confirming big changes, and a new turn clears the pending plan', () => {
    const mem = new AgentMemory();
    expect(mem.prefs).toEqual({ confirmBigChanges: true });
    expect(mem.toChatLog().prefs).toBeUndefined();
    turn(mem, 't1', 'Shed', { plan: 'Plan A' });
    expect(mem.pendingPlan).toBe('Plan A');
    turn(mem, 't2', 'Build it');
    expect(mem.pendingPlan).toBeNull();
  });

  it('merges consecutive user messages, e.g. after a turn that ended on tool results', async () => {
    const mem = new AgentMemory();
    mem.beginTurn('t1', [{ type: 'text', text: 'one' }]);
    mem.append('assistant', [{ type: 'tool_use', id: 'x', name: 'undo', input: {} }]);
    mem.append('user', [{ type: 'tool_result', tool_use_id: 'x', content: 'Undid.' }]);
    mem.endTurn({ asked: 'one', changeSummaries: [] });
    mem.beginTurn('t2', [{ type: 'text', text: 'two' }]);
    const msgs = await mem.toApiMessages();
    expectValidMessages(msgs);
    expect(blocks(msgs[2]!).map((b) => b.type)).toEqual(['tool_result', 'text']);
  });

  it('drops thinking from finished turns but keeps it in the turn in progress', async () => {
    const mem = new AgentMemory();
    mem.beginTurn('t1', [{ type: 'slapdash_project', text: '<project>\nt1\n</project>' }, { type: 'text', text: 'Build a shed' }]);
    mem.append('assistant', [
      { type: 'thinking', thinking: 'Plan the shed.', signature: 'sig-1' },
      { type: 'redacted_thinking', data: 'opaque-1' },
      { type: 'tool_use', id: 'tu-1', name: 'build_wall', input: {} },
    ]);
    mem.append('user', [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'Built wall W1.' }]);
    mem.append('assistant', [
      { type: 'thinking', thinking: 'Done.', signature: 'sig-2' },
      { type: 'text', text: 'Built it.' },
    ]);
    mem.endTurn({ asked: 'Build a shed', changeSummaries: ['Built wall W1.'] });

    mem.beginTurn('t2', [{ type: 'text', text: 'Add a door' }]);
    mem.append('assistant', [
      { type: 'thinking', thinking: 'Where does the door go?', signature: 'sig-3' },
      { type: 'tool_use', id: 'tu-2', name: 'add_door', input: {} },
    ]);
    mem.append('user', [{ type: 'tool_result', tool_use_id: 'tu-2', content: 'Added door D1.' }]);

    const msgs = await mem.toApiMessages();
    expectValidMessages(msgs);
    const isThinking = (b: Block) => b.type === 'thinking' || b.type === 'redacted_thinking';
    const currentStart = msgs.findIndex((m) => blocks(m).some((b) => b.type === 'text' && b.text === 'Add a door'));
    expect(currentStart).toBeGreaterThan(0);
    expect(msgs.slice(0, currentStart).flatMap(blocks).filter(isThinking)).toEqual([]);
    expect(msgs.slice(currentStart).flatMap(blocks).filter(isThinking)).toEqual([
      { type: 'thinking', thinking: 'Where does the door go?', signature: 'sig-3' },
    ]);
    // The finished turn keeps the rest of its content.
    expect(texts(msgs.slice(0, currentStart))).toContain('Built it.');

    // Once the turn ends, its thinking goes too.
    mem.append('assistant', [{ type: 'text', text: 'Door added.' }]);
    mem.endTurn({ asked: 'Add a door', changeSummaries: [] });
    expect((await mem.toApiMessages()).flatMap(blocks).filter(isThinking)).toEqual([]);
  });
});
