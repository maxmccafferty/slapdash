import { fetchKeyholeClient } from '@slapdash/agent';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createChatController } from './agent/chat-controller.ts';
import { ChatProvider } from './agent/ChatContext.tsx';
import { fetchKeyholeStatus } from './agent/keyhole-status.ts';
import { createPhotoStore, preparePhoto } from './agent/photos.ts';
import { browserSnapshotProvider } from './agent/snapshot-provider.ts';
import { debugEnabled, exposeDebug } from './debug.ts';
import { bootstrapModel, openSampleProject } from './model/bootstrap.ts';
import { useChatStore } from './state/chat-store.ts';
import { useModelStore } from './state/model-store.ts';
import { createWebSpeechVoice } from './voice/web-speech.ts';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

bootstrapModel();

const fetchImpl = window.fetch.bind(window);
const voice = createWebSpeechVoice(window);
const chat = createChatController({
  client: fetchKeyholeClient({ fetch: fetchImpl }),
  getStatus: () => fetchKeyholeStatus(fetchImpl),
  photos: createPhotoStore(),
  preparePhoto,
  snapshot: browserSnapshotProvider,
  openSample: () => openSampleProject(),
  // Project storage isn't wired in yet: this is where `session.replaceChat` goes.
  onChatChanged: () => {},
  voice,
});
void chat.start();
if (debugEnabled()) {
  exposeDebug({
    chat: {
      state: () => useChatStore.getState(),
      proposal: () => useModelStore.getState().proposal,
      partCount: () => Object.keys(useModelStore.getState().project?.parts ?? {}).length,
    },
    voice: {
      support: () => ({ ...voice.support }),
    },
  });
}

createRoot(root).render(
  <StrictMode>
    <ChatProvider controller={chat}>
      <App />
    </ChatProvider>
  </StrictMode>,
);
