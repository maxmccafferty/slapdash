import { act, render } from '@testing-library/react';
import { scriptedClient, BUDGET, type ScriptStep } from '@slapdash/agent/testing';
import type { BudgetStatus, KeyholeClient, KeyholeEvent, KeyholeStatus } from '@slapdash/agent';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject } from '@slapdash/core';
import { App } from '../../src/App.tsx';
import { createChatController, type ChatController, type ChatControllerDeps } from '../../src/agent/chat-controller.ts';
import { ChatProvider } from '../../src/agent/ChatContext.tsx';
import { createPhotoStore } from '../../src/agent/photos.ts';
import { buildSampleShell } from '../../src/model/sample-shell.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';

export { BUDGET };

export const status = (budget: Partial<BudgetStatus> = {}, configured = true): KeyholeStatus => ({
  configured,
  model: 'claude-test',
  budget: { ...BUDGET, ...budget },
});

export function newBus(sample = false): CommandBus {
  const bus = new CommandBus({ project: createProject({ name: 'Pool house' }), catalog: TIER1_CATALOG });
  if (sample) buildSampleShell(bus);
  return bus;
}

export interface ChatSetup {
  bus: CommandBus;
  controller: ChatController;
  sent: ReturnType<typeof scriptedClient>['sent'];
  loaded: string[];
}

export interface SetupOptions extends Partial<ChatControllerDeps> {
  steps?: ScriptStep[];
  status?: KeyholeStatus | null;
  sample?: boolean;
  render?: boolean;
}

/** A controller on a real bus with a scripted Claude, rendered inside the whole app. */
export async function setupChat(opts: SetupOptions = {}): Promise<ChatSetup> {
  resetModelStore();
  const bus = newBus(opts.sample ?? false);
  useModelStore.getState().attachBus(bus);
  const script = scriptedClient(opts.steps ?? []);
  const store = createPhotoStore({ createUrl: () => 'blob:photo', revokeUrl: () => {} });
  const loaded: string[] = [];
  const photos = {
    ...store,
    loadFile: async (id: string) => {
      loaded.push(id);
      return store.loadFile(id);
    },
  };
  const controller = createChatController({
    client: script.client,
    getStatus: async () => (opts.status === undefined ? status() : opts.status),
    photos,
    preparePhoto: async (file) => ({ blob: file, mimeType: 'image/jpeg' }),
    ...opts,
  });
  if (opts.render !== false) {
    render(
      <ChatProvider controller={controller}>
        <App />
      </ChatProvider>,
    );
  }
  await act(() => controller.start());
  return { bus, controller, sent: script.sent, loaded };
}

/** A client that stops after `pauseAfter` events until `release()`; it honours the abort signal. */
export function gatedClient(events: KeyholeEvent[], pauseAfter: number) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const client: KeyholeClient = async function* (_messages, signal) {
    for (const [i, e] of events.entries()) {
      if (i === pauseAfter) {
        await gate;
        if (signal?.aborted) throw new DOMException('The turn was stopped.', 'AbortError');
      }
      yield e;
    }
  };
  return { client, release: () => release() };
}
