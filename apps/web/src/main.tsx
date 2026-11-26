import { fetchKeyholeClient } from '@slapdash/agent';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { solverDebug } from './analysis/debug-solver.ts';
import { createChatController } from './agent/chat-controller.ts';
import { ChatProvider } from './agent/ChatContext.tsx';
import { fetchKeyholeStatus } from './agent/keyhole-status.ts';
import { createPhotoStore, preparePhoto } from './agent/photos.ts';
import { browserSnapshotProvider } from './agent/snapshot-provider.ts';
import { debugEnabled, exposeDebug } from './debug.ts';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { createLocalBackend } from '@slapdash/storage/local';
import { siteDefaults } from './model/bootstrap.ts';
import { createProjectsController } from './projects/projects-controller.ts';
import { ProjectsProvider } from './projects/ProjectsContext.tsx';
import type { ShellActions } from './shell/actions.ts';
import { addNote, useChatStore } from './state/chat-store.ts';
import { useShellStore } from './state/shell-store.ts';
import { useModelStore } from './state/model-store.ts';
import { useSiteStore } from './state/site-store.ts';
import { analyzeProject } from './analysis/solver.ts';
import { watchStressExplain } from './analysis/stress-explain.ts';
import { useStressStore } from './analysis/stress-store.ts';
import { createWebSpeechVoice } from './voice/web-speech.ts';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

const note = (text: string) => useChatStore.setState((s) => ({ items: addNote(s.items, text) }));

// Projects live in this browser's IndexedDB (ADR-0001 §10). The last project reopens; a fresh
// install starts on an empty "New project" (first run).
const backend = createLocalBackend();
const projects = createProjectsController({
  store: backend.store,
  device: backend.device,
  catalog: TIER1_CATALOG,
  // Builders size headers and footings from the same resolved loads the solver checks.
  siteDefaults,
  notify: note,
});

const fetchImpl = window.fetch.bind(window);
const voice = createWebSpeechVoice(window);

// One status fetch at startup, shared by the chat and the site defaults: the default
// location (SLAPDASH_DEFAULT_LOCATION) comes from the server, never the bundle.
let firstStatus: ReturnType<typeof fetchKeyholeStatus> | null = fetchKeyholeStatus(fetchImpl);
void firstStatus.then((status) => useSiteStore.getState().setDefaultLocation(status?.defaultLocation ?? null));

const chat = createChatController({
  client: fetchKeyholeClient({ fetch: fetchImpl }),
  getStatus: () => {
    const shared = firstStatus;
    firstStatus = null;
    return shared ?? fetchKeyholeStatus(fetchImpl);
  },
  analysis: (project) => analyzeProject(project, { siteDefaults: useSiteStore.getState().siteDefaults }, 'claude'),
  siteDefaults: () => useSiteStore.getState().siteDefaults,
  photos: createPhotoStore(),
  preparePhoto,
  snapshot: browserSnapshotProvider,
  openSample: () => void projects.openSample(),
  onChatChanged: (log) => projects.onChatChanged(log),
  chatLogFor: (bus) => projects.chatLogFor(bus),
  voice,
});
void chat.start();
void projects.start(window.location.search);

const actions: ShellActions = {
  onSave: () => void projects.save(),
  onLoad: () => useShellStore.getState().togglePanel('projects'),
  onUndo: () => {},
  onRedo: () => {},
};
watchStressExplain(chat);
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
    solver: solverDebug,
    stress: {
      state: () => useStressStore.getState(),
      site: () => useSiteStore.getState().siteDefaults,
      /** Run a command on the current bus (e2e: undersize a header, resize it). */
      execute: (name: string, input: unknown) => {
        const bus = useModelStore.getState().bus;
        if (!bus) throw new Error('No project is open.');
        return bus.execute(name, input);
      },
    },
  });
}

createRoot(root).render(
  <StrictMode>
    <ProjectsProvider controller={projects}>
      <ChatProvider controller={chat}>
        <App actions={actions} />
      </ChatProvider>
    </ProjectsProvider>
  </StrictMode>,
);
