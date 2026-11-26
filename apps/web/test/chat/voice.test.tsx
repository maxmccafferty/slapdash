import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { replyEvents, say } from '@slapdash/agent/testing';
import { describe, expect, it } from 'vitest';
import { NOTHING_HEARD, VOICE_ERROR_NOTES } from '../../src/agent/chat-controller.ts';
import { openSampleProject } from '../../src/model/bootstrap.ts';
import { useChatStore } from '../../src/state/chat-store.ts';
import { fakeVoice } from '../voice/fake-voice.ts';
import { gatedClient, setupChat, status } from './harness.tsx';

const field = () => screen.getByLabelText('Message Claude');
const talk = () => screen.getByRole('button', { name: 'Talk' });
const idle = () => waitFor(() => expect(useChatStore.getState().running).toBeNull());

type Block = { type: string; text?: string };
const lastUserText = (sent: { content?: unknown }[][]) => (sent.at(-1)!.at(-1)!.content as Block[]).at(-1)!.text;

function hold() {
  fireEvent.pointerDown(talk());
}
function letGo() {
  fireEvent.pointerUp(screen.getByRole('button', { name: 'Let go' }));
}

describe('chat: hold to talk', () => {
  it('shows Listening and the words as heard, then sends them and reads the reply aloud', async () => {
    const voice = fakeVoice();
    const { sent } = await setupChat({ voice, steps: [say('Added a 6′ 0″ bench by the 16×20 slab.')] });
    hold();
    expect(screen.getByRole('button', { name: 'Let go' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Listening');
    expect(field()).not.toBeVisible();
    expect(voice.listenCalls).toBe(1);

    act(() => voice.hear({ final: 'Add a', interim: 'bench' }));
    const live = document.querySelector('[data-listening]')!;
    expect(live).toHaveTextContent('Add a bench');
    expect(live.querySelector('[class*="unconfirmed"]')).toHaveTextContent(/^bench$/);

    act(() => voice.hear({ final: 'Add a bench', interim: '' }));
    letGo();
    await idle();
    expect(lastUserText(sent)).toBe('Add a bench');
    expect(document.querySelector('[data-listening]')).toBeNull();
    expect(screen.getByText('Add a bench')).toBeInTheDocument();
    expect(field()).toBeVisible();
    expect(voice.spoken).toEqual(['Added a 6 feet bench by the 16 by 20 slab.']);
  });

  it('Stop shows while the reply is read aloud; it stops the speech and Send comes back', async () => {
    const voice = fakeVoice();
    await setupChat({ voice, steps: [say('Done.')] });
    hold();
    act(() => voice.hear({ final: 'Hi', interim: '' }));
    letGo();
    await idle();
    expect(useChatStore.getState().speaking).toBe(true);
    const before = voice.stopSpeakingCalls;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }));
    expect(voice.stopSpeakingCalls).toBeGreaterThan(before);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(useChatStore.getState().speaking).toBe(false);
  });

  it('holding Talk again interrupts the speech', async () => {
    const voice = fakeVoice();
    await setupChat({ voice, steps: [say('Done.')] });
    hold();
    act(() => voice.hear({ final: 'Hi', interim: '' }));
    letGo();
    await idle();
    expect(voice.speaking).toBe(true);
    hold();
    expect(voice.speaking).toBe(false);
    expect(useChatStore.getState().speaking).toBe(false);
  });

  it('a typed message gets no spoken reply, and sending interrupts speech', async () => {
    const voice = fakeVoice();
    await setupChat({ voice, steps: [say('Spoken.'), say('Typed.')] });
    hold();
    act(() => voice.hear({ final: 'Hi', interim: '' }));
    letGo();
    await idle();
    expect(voice.speaking).toBe(true);
    const user = userEvent.setup();
    // Stop is showing while speaking: type, then Enter sends.
    await user.type(field(), 'Next{Enter}');
    await idle();
    expect(screen.getByText('Typed.')).toBeInTheDocument();
    expect(voice.spoken).toEqual(['Spoken.']);
    expect(voice.speaking).toBe(false);
  });

  it('letting go with nothing heard sends nothing, keeps the draft and says so', async () => {
    const voice = fakeVoice();
    const { sent } = await setupChat({ voice });
    await userEvent.setup().type(field(), 'half typed');
    hold();
    letGo();
    await waitFor(() => expect(screen.getByText(NOTHING_HEARD)).toBeInTheDocument());
    expect(sent).toHaveLength(0);
    expect(field()).toHaveValue('half typed');
  });

  it('a blocked microphone adds a note and Talk stays', async () => {
    const voice = fakeVoice();
    await setupChat({ voice });
    hold();
    act(() => voice.fail('not-allowed'));
    expect(screen.getByText(VOICE_ERROR_NOTES['not-allowed'])).toBeInTheDocument();
    expect(useChatStore.getState().listening).toBeNull();
    letGo();
    expect(talk()).toBeInTheDocument();
  });

  it('recognition refused by the browser hides Talk with a note', async () => {
    const voice = fakeVoice();
    await setupChat({ voice });
    hold();
    act(() => voice.fail('unavailable'));
    expect(screen.getByText("Talking isn't available here. Type instead.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Talk|Let go/ })).not.toBeInTheDocument();
    expect(field()).toBeVisible();
  });

  it('the page hiding while held drops the listening without sending', async () => {
    const voice = fakeVoice();
    const { sent } = await setupChat({ voice });
    hold();
    act(() => voice.hear({ final: 'Add', interim: '' }));
    act(() => voice.hide());
    expect(useChatStore.getState().listening).toBeNull();
    letGo();
    await act(async () => {});
    expect(sent).toHaveLength(0);
  });

  it('Talk is disabled while a turn runs', async () => {
    const events = replyEvents(say('Walls are up.'));
    const gated = gatedClient(events, 1);
    const voice = fakeVoice();
    await setupChat({ voice, client: gated.client });
    const user = userEvent.setup();
    await user.type(field(), 'Build walls');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(talk()).toBeDisabled();
    act(() => gated.release());
    await idle();
    expect(talk()).toBeEnabled();
  });

  it('opening another project cancels listening and speech', async () => {
    const voice = fakeVoice();
    await setupChat({ voice, steps: [say('Done.')] });
    hold();
    act(() => voice.hear({ final: 'Hi', interim: '' }));
    letGo();
    await idle();
    expect(voice.speaking).toBe(true);
    act(() => openSampleProject());
    expect(voice.speaking).toBe(false);

    hold();
    expect(voice.listening).toBe(true);
    act(() => openSampleProject());
    expect(voice.listening).toBe(false);
    expect(useChatStore.getState().listening).toBeNull();
  });

  it('without voice there is no Talk key, and typing still works', async () => {
    await setupChat({ steps: [say('Hello.')] });
    expect(screen.queryByRole('button', { name: 'Talk' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(field(), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await idle();
    expect(screen.getByText('Hello.')).toBeInTheDocument();
  });

  it('Talk stays disabled when capped or not configured', async () => {
    await setupChat({ voice: fakeVoice(), status: status({ state: 'capped', spentUsd: 10, fraction: 1 }) });
    expect(talk()).toBeDisabled();
  });
});
