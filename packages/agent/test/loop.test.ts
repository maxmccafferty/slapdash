import { describe, expect, it } from 'vitest';
import {
  AgentMemory,
  BIG_CHANGE_MESSAGE,
  KeyholeRequestError,
  NO_SNAPSHOT_MESSAGE,
  runTurn,
  type AgentDeps,
  type AgentEvent,
  type SnapshotProvider,
  type UserInput,
} from '../src/index.ts';
import { call, say, scriptedClient, type ScriptStep } from '../testing/scripted-client.ts';
import { SHELL, expectValidMessages, makeBus, poolHouseBus } from './helpers.ts';
import { CATALOG } from '@slapdash/catalog';
import { indexCatalog } from '@slapdash/core';
import { analyze } from '@slapdash/solver';

type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean };

function setup(steps: ScriptStep[], extra: Partial<AgentDeps> = {}) {
  const script = scriptedClient(steps);
  const bus = extra.bus ?? makeBus();
  const memory = extra.memory ?? new AgentMemory();
  const events: AgentEvent[] = [];
  let n = 0;
  const deps: AgentDeps = {
    bus,
    memory,
    client: script.client,
    newTurnId: () => `turn-${++n}`,
    onEvent: (e) => events.push(e),
    ...extra,
  };
  return { deps, bus, memory, script, events };
}

/** The tool results the loop sent back in the last request. */
function lastResults(sent: { content?: unknown }[][]): ToolResultBlock[] {
  const msgs = sent.at(-1)!;
  const last = msgs.at(-1)!;
  return (last.content as { type: string }[]).filter((b): b is ToolResultBlock => b.type === 'tool_result');
}

function resultText(r: ToolResultBlock): string {
  return typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
}

const PLAN = {
  plan: "I'll build a 16×20 pool house on a slab with 9ft walls.",
  footprint: { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } },
  height: '9ft',
};

async function turn(deps: AgentDeps, input: UserInput | string) {
  return runTurn(deps, typeof input === 'string' ? { text: input } : input);
}

describe('acceptance: plan, then the shell in one undo group', () => {
  it('turn 1 shows a plan and changes nothing; turn 2 builds the shell as one undo step', async () => {
    const { deps, bus, script, events, memory } = setup([
      // Turn 1: Claude tries to build at once, is refused, proposes a plan and stops.
      call(SHELL[0]!),
      call(['propose_plan', PLAN]),
      say("Here's the plan: a 16×20 pool house on a slab with 9ft walls. Build it?"),
      // Turn 2: "Build it".
      call(SHELL[0]!, SHELL[1]!, SHELL[2]!),
      call(SHELL[3]!, SHELL[4]!, ['list_materials', {}]),
      call(['snapshot', {}]),
      say('Slab and walls are up: 16×20, 9ft walls with 103 1/2in studs.'),
    ]);
    const before = bus.project;

    const t1 = await turn(deps, 'Build a 16×20 pool house on a slab with 9ft walls');
    expect(script.sent).toHaveLength(3);
    const refused = (script.sent[1]!.at(-1)!.content as ToolResultBlock[])[0]!;
    expect(refused).toMatchObject({ type: 'tool_result', is_error: true });
    expect(resultText(refused)).toContain(BIG_CHANGE_MESSAGE);
    expect(t1.historyEntryId).toBeNull();
    expect(t1.plan).toMatchObject({ text: PLAN.plan, footprint: { from: { x: 0, z: 0 } } });
    expect(t1.plan!.footprint!.to.x).toBeCloseTo(6096, 6);
    expect(t1.plan!.footprint!.to.z).toBeCloseTo(4876.8, 6);
    expect(t1.plan!.height_mm).toBeCloseTo(2743.2, 6);
    expect(events).toContainEqual({ type: 'plan', plan: t1.plan });
    expect(bus.project).toBe(before);
    expect(bus.listHistory()).toEqual([]);
    expect(memory.pendingPlan).toBe(PLAN.plan);

    const t2 = await turn(deps, { text: 'Build it', approvePlan: true });
    expect(script.remaining()).toBe(0);
    expect(t2.refusals).toBe(1); // the snapshot: no renderer here
    expect(resultText(lastResults(script.sent)[0]!)).toBe(NO_SNAPSHOT_MESSAGE);
    const history = bus.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: t2.historyEntryId, source: 'claude', turnId: 'turn-2', label: 'Claude: Build it' });
    expect(history[0]!.summaries).toHaveLength(5);
    const kinds = Object.values(bus.project.assemblies).map((a) => a.kind);
    expect(kinds.filter((k) => k === 'wall')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'foundation')).toHaveLength(1);
    expect(t2.text).toBe('Slab and walls are up: 16×20, 9ft walls with 103 1/2in studs.');
    expect(t2.costUsd).toBeCloseTo(0.04);
    expect(memory.pendingPlan).toBeNull();

    // The second turn's first request carries the new <project> block and the plan.
    const firstOfTurn2 = script.sent[3]!.at(-1)!.content as { type: string; text?: string }[];
    expect(firstOfTurn2[0]!.text).toMatch(/^<project>\n[\s\S]*Pending plan: "I'll build a 16×20 pool house/);
    expect(firstOfTurn2.at(-1)!.text).toBe('Build it');

    for (const sent of script.sent) expectValidMessages(sent);

    expect(bus.undo().ok).toBe(true);
    expect(bus.project.assemblies).toEqual({});
    expect(bus.project.parts).toEqual({});
  });
});

describe('the big-change guard', () => {
  it('refuses building in the same turn as a plan', async () => {
    const { deps, bus, script } = setup([call(['propose_plan', PLAN], ['add_assembly', { name: 'Shed', kind: 'misc' }]), say('Plan above.')]);
    const r = await turn(deps, 'A shed please');
    const [plan, build] = lastResults(script.sent);
    expect(plan!.is_error).toBeUndefined();
    expect(build).toMatchObject({ is_error: true });
    expect(resultText(build!)).toMatch(/You've shown a plan this turn/);
    expect(r.plan?.text).toBe(PLAN.plan);
    expect(bus.project.assemblies).toEqual({});
  });

  it('"just do it" turns the check off for later turns, and it is saved', async () => {
    const { deps, bus, memory } = setup([
      call(['set_preferences', { confirmBigChanges: false }]),
      say("Got it, I'll just build from now on."),
      call(SHELL[0]!),
      say('Slab poured.'),
    ]);
    await turn(deps, 'Just do it from now on');
    expect(memory.prefs).toEqual({ confirmBigChanges: false });
    expect(memory.toChatLog().prefs).toEqual({ confirmBigChanges: false });
    const r = await turn(deps, 'Pour a 16×20 slab');
    expect(r.refusals).toBe(0);
    expect(Object.keys(bus.project.assemblies)).toEqual(['FD1']);
  });

  it('refuses a call whose dry run reaches 50 parts this turn, and lets small edits through', async () => {
    const longWall = { start: { x: 0, z: 0 }, end: { x: '40ft', z: 0 }, height: '9ft' };
    const { deps, bus, script } = setup([
      call(['build_wall', longWall]),
      call(['add_assembly', { name: 'Bench', kind: 'misc' }]),
      call(['add_part', { assemblyId: 'M1', role: 'other', materialId: 'spf-no2', sectionId: '2x4', position: { x: 0, y: 0, z: '-5ft' }, length: '6ft' }]),
      say('Added a bench board; the long wall needs a plan first.'),
    ]);
    const r = await turn(deps, 'A 40ft wall and a bench');
    const wall = script.sent[1]!.at(-1)!.content as ToolResultBlock[];
    expect(wall[0]).toMatchObject({ is_error: true });
    expect(resultText(wall[0]!)).toMatch(/big change.*It would bring the parts made this turn to \d+\./);
    expect(Object.keys(bus.project.assemblies)).toEqual(['M1']);
    expect(Object.keys(bus.project.parts)).toEqual(['M1-X01']);
    expect(r.refusals).toBe(1);
  });

  it('counts parts across the turn: the second 20ft wall pushes past 50', async () => {
    const { deps, bus, script } = setup([call(SHELL[1]!), call(SHELL[2]!), say('One wall up.')]);
    await turn(deps, 'Two walls');
    expect(resultText(lastResults(script.sent)[0]!)).toContain(BIG_CHANGE_MESSAGE);
    expect(Object.keys(bus.project.assemblies)).toEqual(['W1']);
  });

  it('a plain reply after a plan counts as the answer; "Change something" does not', async () => {
    const { deps, bus } = setup([
      call(['propose_plan', PLAN]),
      say('Plan above.'),
      call(SHELL[0]!),
      say('Okay, what should change?'),
      call(['propose_plan', PLAN]),
      say('Plan above.'),
      call(SHELL[0]!),
      say('Slab poured.'),
    ]);
    await turn(deps, 'A pool house');
    const changed = await turn(deps, { text: 'Make it smaller', approvePlan: false });
    expect(changed.refusals).toBe(1);
    await turn(deps, 'A pool house');
    const yes = await turn(deps, 'Sounds good');
    expect(yes.refusals).toBe(0);
    expect(Object.keys(bus.project.assemblies)).toEqual(['FD1']);
  });

  it('never needs a plan for undo', async () => {
    const bus = makeBus();
    bus.execute(...(SHELL[0]! as [string, unknown]));
    const { deps } = setup([call(['undo', {}]), say('Undone.')], { bus });
    const r = await turn(deps, 'Undo that');
    expect(r.refusals).toBe(0);
    expect(bus.project.assemblies).toEqual({});
  });
});

describe('turn caps', () => {
  it('refuses the call past maxToolCalls, then stops after one wrap-up request', async () => {
    const q = ['find_parts', {}] as [string, unknown];
    const { deps, script } = setup([call(q, q, q, q), call(q), say('never sent')], { caps: { maxToolCalls: 3 } });
    const r = await turn(deps, 'Look around');
    const results = script.sent[1]!.at(-1)!.content as ToolResultBlock[];
    expect(results.map((x) => x.is_error ?? false)).toEqual([false, false, false, true]);
    expect(resultText(results[3]!)).toMatch(/Turn limit reached: at most 3 tool calls per turn\..*Nothing else will run this turn\./);
    expect(script.sent).toHaveLength(2);
    expect(script.remaining()).toBe(1);
    expect(r.capped).toBe('tool calls');
    expect(r.toolCalls).toBe(3);
    const after = await deps.memory.toApiMessages();
    expectValidMessages(after);
  });

  it('caps snapshots the same way', async () => {
    const snapshot: SnapshotProvider = async () => ({ data: 'PNG', width: 768, height: 768, angle: 'sheet', mode: 'textured', notes: [] });
    const s = ['snapshot', {}] as [string, unknown];
    const { deps, script } = setup([call(s, s), say('Seen enough.')], { caps: { maxSnapshots: 1 }, snapshot });
    const r = await turn(deps, 'Look');
    const results = lastResults(script.sent);
    expect(results[0]!.is_error).toBeUndefined();
    expect(resultText(results[1]!)).toMatch(/at most 1 snapshots per turn/);
    expect(r.capped).toBe('snapshots');
    expect(r.text).toBe('Seen enough.');
  });

  it('leaves one request to wrap up when the round trips run out', async () => {
    const q = ['find_parts', {}] as [string, unknown];
    const { deps, script } = setup([call(q), call(q), say('never sent')], { caps: { maxRequests: 2 } });
    const r = await turn(deps, 'Keep looking');
    expect(script.sent).toHaveLength(2);
    const notice = (script.sent[1]!.at(-1)!.content as { type: string; text?: string }[]).at(-1)!;
    expect(notice.text).toMatch(/at most 2 requests to Claude per turn/);
    expect(r.capped).toBe('requests to Claude');
    expectValidMessages(await deps.memory.toApiMessages());
  });
});

describe('tools in the loop', () => {
  it('a refused command is information: the error goes back and the loop continues', async () => {
    const bad = { ...(SHELL[1]![1] as object), materials: { lumber: 'spf-no3' } };
    const { deps, script, bus } = setup([call(['build_wall', bad]), call(SHELL[1]!), say('Built with spf-no2.')]);
    const r = await turn(deps, 'A wall');
    const err = script.sent[1]!.at(-1)!.content as ToolResultBlock[];
    expect(err[0]).toMatchObject({ is_error: true });
    expect(resultText(err[0]!)).toMatch(/spf-no3[\s\S]*Nothing has changed\.$/);
    expect(r.refusals).toBe(1);
    expect(Object.keys(bus.project.assemblies)).toEqual(['W1']);
  });

  it('invalid tool JSON is refused without running', async () => {
    const { deps, script } = setup([
      { content: [{ type: 'tool_use', name: 'add_assembly', input: null, rawJson: '{"name": "Sh' }], stopReason: 'tool_use' },
      say('Sorry.'),
    ]);
    await turn(deps, 'x');
    expect(resultText(lastResults(script.sent)[0]!)).toMatch(/^Your input for add_assembly wasn't valid JSON/);
  });

  it('sends snapshots back as images and photos wrapped as data', async () => {
    const snapshot: SnapshotProvider = async (req) => ({ data: 'PNGDATA', width: 768, height: 768, angle: String(req.angle), mode: req.mode, notes: ['The roof is hidden.'] });
    const { deps, script } = setup([call(['snapshot', { angle: 'top' }]), say('Looks square.')], {
      snapshot,
      memory: new AgentMemory(undefined, { loadFile: async () => ({ data: 'JPEGDATA', mediaType: 'image/jpeg' }) }),
    });
    await turn(deps, { text: 'Here is my yard', photos: [{ fileId: 'f1', mimeType: 'image/jpeg' }] });
    const first = script.sent[0]![0]!.content as { type: string; text?: string; source?: { data: string } }[];
    expect(first.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text']);
    expect(first[1]!.text).toMatch(/^<photo from the person/);
    expect(first[2]!.source!.data).toBe('JPEGDATA');
    const snap = lastResults(script.sent)[0]!.content as { type: string; text?: string; source?: { data: string } }[];
    expect(snap[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PNGDATA' } });
    expect(snap[1]!.text).toBe('Snapshot: top view, textured, 768px, 768×768. The roof is hidden. Images are for noticing; measure for exact numbers.');
    expect(JSON.stringify(deps.memory.toChatLog())).not.toContain('PNGDATA');
  });

  it('request_photo ends up in the result and as an event', async () => {
    const { deps, events } = setup([call(['request_photo', { what: 'the wall where the deck attaches' }]), say('Can you send a photo?')]);
    const r = await turn(deps, 'Attach a deck to my house');
    expect(r.photoRequest).toBe('the wall where the deck attaches');
    expect(events).toContainEqual({ type: 'photo_request', what: 'the wall where the deck attaches' });
    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe('Can you send a photo?');
  });
});

describe('can\'t do it and pointing', () => {
  it('offer_options ends up in the result and as an event, and changes nothing', async () => {
    const options = ['Use a beam with a post in the middle', 'Make the opening 12ft'];
    const { deps, events, bus } = setup([call(['offer_options', { options }]), say("A 24ft opening needs an engineered beam. Nothing has changed yet.")]);
    const r = await turn(deps, 'Make a 24ft opening with no posts');
    expect(r.options).toEqual(options);
    expect(r.historyEntryId).toBeNull();
    expect(r.refusals).toBe(0);
    expect(events).toContainEqual({ type: 'options', options });
    expect(bus.listHistory(1)).toEqual([]);
  });

  it('refuses one option or four', async () => {
    const { deps, script } = setup([call(['offer_options', { options: ['Only one'] }]), call(['offer_options', { options: ['a', 'b', 'c', 'd'] }]), say('Hmm.')]);
    const r = await turn(deps, 'x');
    expect(r.options).toBeNull();
    expect(r.refusals).toBe(2);
    expect(lastResults(script.sent)[0]!.is_error).toBe(true);
  });

  it('sends the tapped part before the text', async () => {
    const { deps, script } = setup([say('Raised it.')]);
    await turn(deps, { text: 'make this taller', pointedAt: { id: 'W3-H01', label: 'Header, South wall' } });
    const first = script.sent[0]![0]!.content as { type: string; text?: string }[];
    expect(first).toHaveLength(3);
    expect(first[0]!.text).toMatch(/^<project>/);
    expect(first[2]!.text).toBe('make this taller');
    expect(first[1]!.text).toBe('<pointing_at part="W3-H01">Header, South wall</pointing_at>');
  });
});

describe('when things go wrong', () => {
  it('a budget cap mid-turn raises KeyholeRequestError, closes the group and keeps the history valid', async () => {
    const capped = new KeyholeRequestError({ error: 'budget_capped', budget: { state: 'capped', spentUsd: 10, capUsd: 10, fraction: 1, month: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z' } }, 402);
    const { deps, bus, memory, events } = setup([call(['add_assembly', { name: 'Shed', kind: 'misc' }]), capped]);
    const err = await turn(deps, 'A shed').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyholeRequestError);
    expect((err as KeyholeRequestError).state).toBe('capped');
    expect(events.at(-1)).toEqual({ type: 'error', error: capped });
    expect(bus.inGroup).toBe(false);
    expect(bus.listHistory()).toMatchObject([{ source: 'claude', turnId: 'turn-1' }]);
    memory.beginTurn('next', [{ type: 'text', text: 'Try again' }]);
    expectValidMessages(await memory.toApiMessages());
  });

  it('a reply cut off mid tool call gets synthetic results', async () => {
    const { deps, memory } = setup([{ content: [{ type: 'text', text: 'Building' }, { type: 'tool_use', name: 'build_wall', input: {} }], stopReason: 'max_tokens' }]);
    const r = await turn(deps, 'A wall');
    expect(r.notes).toEqual(["Claude's reply hit the length limit and was cut short."]);
    expect(memory.unansweredToolUses()).toEqual([]);
    memory.beginTurn('next', [{ type: 'text', text: 'Continue' }]);
    const msgs = await memory.toApiMessages();
    expectValidMessages(msgs);
    expect(JSON.stringify(msgs)).toContain('Stopped: build_wall did not run because the turn ended.');
  });

  it('cancelling stops the turn: remaining calls are refused and no more requests go out', async () => {
    const controller = new AbortController();
    const q = ['find_parts', {}] as [string, unknown];
    const { deps, script } = setup([call(q, q), say('never sent')], {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === 'tool_result') controller.abort();
      },
    });
    const r = await turn(deps, 'Look');
    expect(r.aborted).toBe(true);
    expect(script.sent).toHaveLength(1);
    expect(deps.memory.unansweredToolUses()).toEqual([]);
    const results = deps.memory.messages.at(-1)!.content as ToolResultBlock[];
    expect(results[1]).toMatchObject({ is_error: true, content: expect.stringMatching(/^Stopped: the person cancelled/) });
  });
});

describe('the automatic stress turn', () => {
  it('reads the <stress_view> note, calls check_structure, then offers the fix first', async () => {
    const stress = {
      worst: { id: 'W3-H02', label: 'Header, South wall', utilization: 1.4, check: 'shear', combo: 'D+S' },
      overCount: 1,
      unstable: [],
    };
    const index = indexCatalog(CATALOG);
    let analysed = 0;
    const { deps, script, events } = setup(
      [
        call(['check_structure', { assembly: 'W3', limit: 3 }]),
        call(['offer_options', { options: ['Upsize the sliding door header to 2-2x10', 'Leave it'] }]),
        say('The sliding door header is at about 140% of its limit in shear under snow. Planning estimate, not an engineering check.'),
        say('Done.'),
        say('Done.'),
      ],
      {
        bus: poolHouseBus(),
        analysis: async (p) => {
          analysed++;
          return analyze(p, index);
        },
      },
    );
    const t = await turn(deps, { text: 'Stress view on', stress });
    const first = JSON.stringify(script.sent[0]!.at(-1)!.content);
    expect(first).toContain('<stress_view>The person just turned on the stress view. Most loaded: Header, South wall (W3-H02) at 140% of its limit (shear under D+S). 1 part is over the limit.');
    expect(analysed).toBe(1);
    const report = lastResults(script.sent.slice(0, 2))[0]!;
    expect(report.is_error).toBeUndefined();
    expect(resultText(report)).toMatch(/^Planning estimate, not an engineering check/);
    expect(resultText(report)).toContain('Scope: W3');
    const toolStarts = events.filter((e) => e.type === 'tool_start').map((e) => (e as { name: string }).name);
    expect(toolStarts).toEqual(['check_structure', 'offer_options']);
    expect(t.options).toEqual(['Upsize the sliding door header to 2-2x10', 'Leave it']);

    // Two turns later the note has aged out, like the <project> block.
    await turn(deps, 'ok');
    await turn(deps, 'ok');
    const later = JSON.stringify(script.sent.at(-1));
    expect(later).not.toContain('<stress_view>');
    expect(later).toContain('[stress view note omitted');
  });
});
