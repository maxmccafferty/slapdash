import { act, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { call, replyEvents, say, scriptedClient } from '@slapdash/agent/testing';
import { AgentMemory, KeyholeRequestError, KeyholeStreamFailure } from '@slapdash/agent';
import { describe, expect, it, vi } from 'vitest';
import { openSampleProject } from '../../src/model/bootstrap.ts';
import { useChatStore } from '../../src/state/chat-store.ts';
import { createChatController } from '../../src/agent/chat-controller.ts';
import { createPhotoStore } from '../../src/agent/photos.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { setViewportWidth } from '../setup.ts';
import { fakeVoice } from '../voice/fake-voice.ts';
import { OPEN_SAMPLE, STARTERS } from '../../src/shell/chat/Starters.tsx';
import { gatedClient, newBus, setupChat, status } from './harness.tsx';

const field = () => screen.getByRole('textbox', { name: 'Message Claude' });

async function sendText(text: string) {
  const user = userEvent.setup();
  await user.type(field(), text);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(useChatStore.getState().running).toBeNull());
}

type Block = { type: string; text?: string; is_error?: boolean; source?: { data: string } };
const lastUserBlocks = (sent: { content?: unknown }[][]) => sent.at(-1)!.at(-1)!.content as Block[];

const BENCH = [
  ['add_assembly', { name: 'Bench', kind: 'misc' }],
  ['add_part', { assemblyId: 'M1', role: 'other', materialId: 'spf-no2', sectionId: '2x4', position: { x: 0, y: 0, z: '-5ft' }, length: '6ft' }],
] as [string, unknown][];

const PLAN = {
  plan: "I'll build a 16×20 pool house on a slab with 9ft walls.",
  footprint: { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } },
  height: '9ft',
};

describe('chat: talking', () => {
  it('streams text in as it arrives; Send turns into Stop, and Stop ends the turn with "Stopped."', async () => {
    const events = replyEvents(say('Walls are up. Door and window tops line up.'));
    // Pause after the first text delta.
    const firstDelta = events.findIndex((e) => e.event === 'anthropic' && e.data.type === 'content_block_delta') + 1;
    const gated = gatedClient(events, firstDelta);
    await setupChat({ client: gated.client });
    const user = userEvent.setup();
    await user.type(field(), 'Build walls');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/^Walls are up\. Door/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    act(() => gated.release());
    await waitFor(() => expect(screen.getByText('Stopped.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(useChatStore.getState().running).toBeNull();
  });

  it('shows the person\'s message and announces the finished reply once', async () => {
    await setupChat({ steps: [say('Hi. What size?')] });
    await sendText('A shed');
    expect(screen.getByText('A shed')).toBeInTheDocument();
    expect(screen.getByTestId('chat-announcer')).toHaveTextContent('Claude: Hi. What size?');
  });

  it('shows Working… while Claude runs tools', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await setupChat({
      steps: [call(['snapshot', {}]), say('Looks square.')],
      snapshot: async (req) => {
        await gate;
        return { data: 'PNG', width: 10, height: 10, angle: String(req.angle), mode: req.mode, notes: [] };
      },
    });
    const user = userEvent.setup();
    await user.type(field(), 'Have a look');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('working')).toHaveTextContent('Working…'));
    act(() => release());
    await waitFor(() => expect(screen.getByText('Looks square.')).toBeInTheDocument());
    expect(screen.queryByTestId('working')).not.toBeInTheDocument();
  });
});

describe('chat: small change and Undo', () => {
  it('shows Undo under the reply; it undoes the turn and then reads Undone', async () => {
    const { bus } = await setupChat({ steps: [call(...BENCH), say('Added a 6ft bench board.'), call(['delete_parts', { ids: ['M1-X01'] }]), say('Removed it.')] });
    await sendText('Add a bench');
    expect(Object.keys(bus.project.parts)).toEqual(['M1-X01']);
    const undo = screen.getByRole('button', { name: 'Undo this change' });
    expect(undo).toBeEnabled();
    await userEvent.setup().click(undo);
    expect(bus.project.parts['M1-X01']).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Undone' })).toBeDisabled();
  });

  it('is disabled once a later change exists', async () => {
    await setupChat({ steps: [call(...BENCH), say('Added it.'), call(BENCH[1]!), say('Added another.')] });
    await sendText('Add a bench');
    await sendText('Another one');
    const keys = screen.getAllByRole('button', { name: 'Undo this change' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeDisabled();
    expect(keys[1]).toBeEnabled();
  });
});

describe('chat: plan', () => {
  it('shows the plan card and the dashed outline in mm; Build it approves and clears the outline', async () => {
    const { bus, sent } = await setupChat({ steps: [call(['propose_plan', PLAN]), say(PLAN.plan), call(['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }]), say('Slab is down.')] });
    await sendText('Build me a pool house');
    const card = screen.getByRole('group', { name: 'Plan' });
    expect(within(card).getByText(PLAN.plan)).toBeInTheDocument();
    const proposal = useModelStore.getState().proposal!;
    expect(proposal.footprint.to.x).toBeCloseTo(6096, 3);
    expect(proposal.footprint.to.z).toBeCloseTo(4876.8, 3);
    expect(proposal.height_mm).toBeCloseTo(2743.2, 3);
    expect(bus.listHistory()).toHaveLength(0);

    await userEvent.setup().click(within(card).getByRole('button', { name: 'Build it' }));
    await waitFor(() => expect(useChatStore.getState().running).toBeNull());
    expect(useModelStore.getState().proposal).toBeNull();
    expect(lastUserBlocks(sent.slice(0, 3)).at(-1)!.text).toBe('Build it');
    // The guard let the slab through, so the answer was approval.
    expect(lastUserBlocks(sent).some((b) => b.is_error)).toBe(false);
    expect(Object.keys(bus.project.assemblies)).toHaveLength(1);
    expect(within(card).getByRole('button', { name: 'Build it' })).toBeDisabled();
  });

  it('Change something focuses the field and the next message answers no', async () => {
    // Plans are opt-in (ADR-0002 §F1): this person asked for them, so the guard is on.
    const { bus, sent } = await setupChat({
      chatLogFor: () => ({ version: 1, messages: [], prefs: { confirmBigChanges: true } }),
      steps: [call(['propose_plan', PLAN]), say(PLAN.plan), call(['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }]), say('Needs a new plan.')],
    });
    await sendText('Build me a pool house');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change something' }));
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute('placeholder', 'What should change?');
    expect(useModelStore.getState().proposal).toBeNull();
    await sendText('Make it 12×16');
    // Not approved: the big change is refused.
    expect(lastUserBlocks(sent)[0]!.is_error).toBe(true);
    expect(Object.keys(bus.project.assemblies)).toHaveLength(0);
  });
});

describe("chat: can't do it", () => {
  it('shows the options and "Nothing has changed yet." once; tapping one sends it', async () => {
    const options = ['Use a beam with a post in the middle', 'Make the opening 12ft'];
    const { sent } = await setupChat({
      steps: [call(['offer_options', { options }]), say('A 24ft opening needs an engineered beam. Nothing has changed yet.'), say('Okay, 12ft it is.')],
    });
    await sendText('A 24ft opening with no posts');
    const group = screen.getByRole('group', { name: 'Options' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(options);
    expect(screen.getAllByText(/Nothing has changed yet\./)).toHaveLength(1);
    expect(screen.getByText('A 24ft opening needs an engineered beam.')).toBeInTheDocument();

    await userEvent.setup().click(within(group).getByRole('button', { name: options[1] }));
    await waitFor(() => expect(useChatStore.getState().running).toBeNull());
    expect(lastUserBlocks(sent).at(-1)!.text).toBe(options[1]);
    expect(within(group).getByRole('button', { name: options[1] })).toBeDisabled();
  });
});

describe('chat: photo request', () => {
  it('offers Take photo and Choose photo; a picked photo goes with the next message', async () => {
    const { sent, loaded } = await setupChat({ steps: [call(['request_photo', { what: 'the wall where the deck attaches' }]), say('Can you send a photo?'), say('I see siding.')] });
    expect(screen.queryByTestId('take-photo-input')).not.toBeInTheDocument();
    await sendText('Attach a deck to my house');
    expect(screen.getByText('Photo of the wall where the deck attaches')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeEnabled();
    const take = screen.getByTestId('take-photo-input');
    expect(take).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('choose-photo-input')).not.toHaveAttribute('capture');

    await act(async () => {
      fireEvent.change(take, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'wall.jpg', { type: 'image/jpeg' })] } });
    });
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photo 1 to send' })).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useChatStore.getState().running).toBeNull());
    expect(loaded).toHaveLength(1);
    const blocks = lastUserBlocks(sent.slice(0, 3));
    expect(blocks.find((b) => b.type === 'image')!.source!.data).toBe('AQID');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    expect(screen.queryByRole('img', { name: 'Photo 1 to send' })).not.toBeInTheDocument();
  });
});

describe('chat: pointing at a part', () => {
  it('shows the tapped part as a chip; sending attaches it and clears the selection', async () => {
    const { sent } = await setupChat({ sample: true, steps: [say('Raised the header.')] });
    act(() => useModelStore.getState().select('W3-H01'));
    expect(screen.getByTestId('part-chip')).toHaveTextContent('Header, South wall');
    expect(screen.getByRole('button', { name: 'Remove Header, South wall' })).toBeInTheDocument();
    await sendText('make this taller');
    expect(useModelStore.getState().selectedPartId).toBeNull();
    const chips = screen.getAllByTestId('part-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Header, South wall');
    expect(sent[0]![0]!.content).toContainEqual({ type: 'text', text: '<pointing_at part="W3-H01">Header, South wall</pointing_at>' });
  });
});

describe('chat: monthly limit', () => {
  it('shows the 80% note once', async () => {
    await setupChat({ status: status({ state: 'warning', spentUsd: 8, fraction: 0.8 }) });
    expect(screen.getByText("80% of this month's Claude budget is used: $8.00 of $10.00.")).toBeInTheDocument();
    await act(() => setupChatAgain());
    expect(screen.getAllByText(/80% of this month/)).toHaveLength(1);
  });

  it('capped: the field and Talk are disabled with the return date; the header and view controls still work', async () => {
    await setupChat({ voice: fakeVoice(), status: status({ state: 'capped', spentUsd: 10, fraction: 1 }) });
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Talk' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByTestId('capped-note')).toHaveTextContent('Claude is back on December 1. Everything else keeps working.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: '2D' })).toBeEnabled();
  });

  it('a 402 while sending switches to the capped state', async () => {
    const capped = { ...status().budget, state: 'capped' as const, spentUsd: 10, fraction: 1 };
    await setupChat({ steps: [new KeyholeRequestError({ error: 'budget_capped', budget: capped }, 402)] });
    await sendText('Hello');
    expect(useChatStore.getState().connection).toBe('capped');
    expect(field()).toBeDisabled();
  });
});

describe('chat: no API key', () => {
  it('explains, disables the field and Talk, and opens the sample pool house', async () => {
    await setupChat({ voice: fakeVoice(), status: status({}, false), openSample: () => openSampleProject() });
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Talk' })).toBeDisabled();
    expect(screen.getByTestId('no-key-note')).toHaveTextContent("Claude isn't connected");
    const before = useModelStore.getState().bus;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open the sample pool house' }));
    const bus = useModelStore.getState().bus!;
    expect(bus).not.toBe(before);
    expect(Object.keys(bus.project.parts).length).toBeGreaterThan(50);
    expect(useChatStore.getState().items).toEqual([]);
  });
});

describe('chat: first run', () => {
  it('an empty site shows "What are we building?", three starters and the sample', async () => {
    await setupChat();
    const starters = screen.getByRole('group', { name: 'Start with' });
    expect(screen.getByText('What are we building?')).toBeInTheDocument();
    expect(within(starters).getAllByRole('button').map((b) => b.textContent)).toEqual([...STARTERS]);
    expect(screen.getByRole('button', { name: OPEN_SAMPLE })).toBeEnabled();
  });

  it('tapping a starter sends it', async () => {
    await setupChat({ steps: [say('A shed it is. What roof?')] });
    await userEvent.setup().click(screen.getByRole('button', { name: STARTERS[0] }));
    await waitFor(() => expect(useChatStore.getState().running).toBeNull());
    expect(screen.getByText(STARTERS[0])).toBeInTheDocument();
    expect(screen.getByText('A shed it is. What roof?')).toBeInTheDocument();
    expect(screen.queryByTestId('starters')).not.toBeInTheDocument();
  });

  it('Open the sample pool house calls openSample', async () => {
    let opened = 0;
    await setupChat({ openSample: () => opened++ });
    await userEvent.setup().click(screen.getByRole('button', { name: OPEN_SAMPLE }));
    expect(opened).toBe(1);
  });

  it('no starters once the project has parts', async () => {
    await setupChat({ sample: true });
    expect(screen.getByText('What are we building?')).toBeInTheDocument();
    expect(screen.queryByTestId('starters')).not.toBeInTheDocument();
  });

  it('no starters in the no-key state; its own sample key stays', async () => {
    await setupChat({ status: status({}, false) });
    expect(screen.queryByTestId('starters')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: OPEN_SAMPLE })).toHaveLength(1);
  });
});

describe('chat: opening a saved project', () => {
  it('keeps the notes shown before the first project opened (storage loads after the status)', async () => {
    resetModelStore();
    const controller = createChatController({
      client: scriptedClient([]).client,
      getStatus: async () => status({ state: 'warning', spentUsd: 8, fraction: 0.8 }),
      photos: createPhotoStore({ createUrl: () => 'blob:photo', revokeUrl: () => {} }),
      preparePhoto: async (file) => ({ blob: file, mimeType: 'image/jpeg' }),
    });
    await controller.start();
    act(() => {
      useModelStore.getState().attachBus(newBus());
    });
    expect(useChatStore.getState().items.map((i) => i.kind === 'note' && i.text)).toEqual(["80% of this month's Claude budget is used: $8.00 of $10.00."]);
    // Opening another project after that starts its own transcript.
    act(() => {
      useModelStore.getState().attachBus(newBus());
    });
    expect(useChatStore.getState().items).toEqual([]);
    controller.dispose();
  });

  it('restores the saved transcript for the new bus', async () => {
    const memory = new AgentMemory();
    memory.beginTurn('t1', [{ type: 'text', text: 'How tall are the walls?' }]);
    memory.append('assistant', [{ type: 'text', text: 'Nine feet, to the top plate.' }]);
    memory.endTurn({ asked: 'How tall are the walls?', changeSummaries: [] });
    const saved = newBus(true);
    const { sent } = await setupChat({ steps: [say('Sure.')], chatLogFor: (b) => (b === saved ? memory.toChatLog() : null) });
    act(() => {
      useModelStore.getState().attachBus(saved);
    });
    expect(screen.getByText('How tall are the walls?')).toBeInTheDocument();
    expect(screen.getByText('Nine feet, to the top plate.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo this change' })).not.toBeInTheDocument();
    // Claude sees the earlier turn too.
    await sendText('And the roof?');
    const first = sent.at(-1)![0]!.content as Block[];
    expect(first.some((b) => b.text === 'How tall are the walls?')).toBe(true);
  });
});

describe('chat: errors', () => {
  it('rate limits and upstream failures show a note and keep the field usable', async () => {
    await setupChat({
      steps: [
        new KeyholeRequestError({ error: 'rate_limited', retryAfterSeconds: 30 }, 429),
        new KeyholeStreamFailure({ error: 'upstream', message: 'overloaded', retryable: true }),
        new KeyholeRequestError({ error: 'network', message: 'offline' }, 0),
      ],
    });
    await sendText('One');
    expect(screen.getByText('Too many messages. Try again in 30 seconds.')).toBeInTheDocument();
    await sendText('Two');
    expect(screen.getByText('Claude is busy right now. Try again in a minute.')).toBeInTheDocument();
    await sendText('Three');
    expect(screen.getByText("Couldn't reach Claude. Check your connection and try again.")).toBeInTheDocument();
    expect(field()).toBeEnabled();
    expect(screen.queryAllByTestId('claude-message')).toHaveLength(0);
  });
  it("a 401 sign_in_required says you've been signed out and tells the app", async () => {
    const onSignedOut = vi.fn();
    await setupChat({ steps: [new KeyholeRequestError({ error: 'sign_in_required' }, 401)], onSignedOut });
    await sendText('Hello');
    expect(screen.getByText("You've been signed out. Sign in again to talk to Claude.")).toBeInTheDocument();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(field()).toBeEnabled();
  });
});

/** Modals cover the model area only: the chat never goes inert. */
function expectChatUsable() {
  const textbox = field();
  expect(textbox).toBeEnabled();
  for (let el: HTMLElement | null = textbox; el; el = el.parentElement) {
    expect(el.hasAttribute('inert'), el.tagName).toBe(false);
    expect(el.getAttribute('aria-hidden'), el.tagName).not.toBe('true');
  }
  act(() => textbox.focus());
  expect(textbox).toHaveFocus();
}

/** The chat takes typing while a modal is open, and the modal stays open. */
async function expectChatTypes(panel: 'materials' | 'steps') {
  const user = userEvent.setup();
  await user.click(field());
  await user.type(field(), 'Price 2x4s at 50 cents a foot');
  expect(field()).toHaveValue('Price 2x4s at 50 cents a foot');
  expect(useShellStore.getState().panel).toBe(panel);
}

describe('chat: modals leave it usable', () => {
  it('desktop, with the real Materials modal on the sample shell', async () => {
    await setupChat({ sample: true });
    act(() => useShellStore.getState().togglePanel('materials'));
    expect(screen.getByRole('dialog', { name: 'Materials' })).toBeInTheDocument();
    expectChatUsable();
    await expectChatTypes('materials');
  });

  for (const panel of ['materials', 'steps'] as const) {
    it(`desktop, with ${panel} open`, async () => {
      await setupChat();
      act(() => useShellStore.getState().togglePanel(panel));
      expectChatUsable();
      await expectChatTypes(panel);
    });

    it(`phone sheet, with ${panel} open`, async () => {
      setViewportWidth(390);
      await setupChat();
      act(() => useShellStore.getState().setChatOpen(true));
      act(() => useShellStore.getState().togglePanel(panel));
      expectChatUsable();
      await expectChatTypes(panel);
    });
  }
});

describe('chat: state outlives the phone sheet', () => {
  it('closing the sheet mid-turn and reopening it shows the streamed text', async () => {
    setViewportWidth(390);
    const events = replyEvents(say('Walls are up.'));
    const gated = gatedClient(events, events.length - 2);
    await setupChat({ client: gated.client });
    act(() => useShellStore.getState().setChatOpen(true));
    const user = userEvent.setup();
    await user.type(field(), 'Build walls');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Walls are up.')).toBeInTheDocument());
    act(() => useShellStore.getState().setChatOpen(false));
    expect(screen.queryByText('Walls are up.')).not.toBeInTheDocument();
    act(() => gated.release());
    await waitFor(() => expect(useChatStore.getState().running).toBeNull());
    act(() => useShellStore.getState().setChatOpen(true));
    expect(screen.getByText('Walls are up.')).toBeInTheDocument();
  });
});

/** A second status read (a reload of the status) must not repeat the 80% note. */
async function setupChatAgain() {
  const { createChatController } = await import('../../src/agent/chat-controller.ts');
  const c = createChatController({
    client: async function* () {},
    getStatus: async () => status({ state: 'warning', spentUsd: 8.5, fraction: 0.85 }),
    photos: { put: async () => ({ fileId: '', mimeType: '', url: '' }), remove: () => {}, loadFile: async () => null, revokeAll: () => {} },
    preparePhoto: async (f) => ({ blob: f, mimeType: 'image/jpeg' }),
  });
  await c.start();
  c.dispose();
}
