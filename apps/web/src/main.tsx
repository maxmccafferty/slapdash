import { fetchKeyholeClient } from '@slapdash/agent';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SignInCard } from './auth/SignInCard.tsx';
import { solverDebug } from './analysis/debug-solver.ts';
import { createChatController } from './agent/chat-controller.ts';
import { ChatProvider } from './agent/ChatContext.tsx';
import { fetchKeyholeStatus } from './agent/keyhole-status.ts';
import { createPhotoStore, preparePhoto } from './agent/photos.ts';
import { browserSnapshotProvider } from './agent/snapshot-provider.ts';
import { debugEnabled, exposeDebug } from './debug.ts';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { siteDefaults } from './model/bootstrap.ts';
import { createProjectsController } from './projects/projects-controller.ts';
import { openBackend } from './storage/backend.ts';
import { movedNote } from './sync/sync-status.ts';
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
const rootEl = root;
const reactRoot = createRoot(rootEl);

const note = (text: string) => useChatStore.setState((s) => ({ items: addNote(s.items, text) }));

/** The service worker (PWA): production builds only, never under `?e2e` unless `?pwa` asks for it. */
async function registerServiceWorker(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (!import.meta.env.PROD || (debugEnabled() && !params.has('pwa'))) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    // No offline copy this time; the app works the same online.
  }
}

async function boot(): Promise<void> {
  // Local-only: projects in this browser's IndexedDB (ADR-0001 §10). Hosted with Supabase:
  // the sign-in card until someone signs in, then a per-user IndexedDB synced to the cloud.
  const backend = await openBackend({
    showSignIn: (auth) =>
      new Promise((resolve) => {
        reactRoot.render(
          <StrictMode>
            <SignInCard auth={auth} onSignedIn={resolve} />
          </StrictMode>,
        );
      }),
  });

  // The last project reopens; a fresh install starts on an empty "New project" (first run).
  const projects = createProjectsController({
    store: backend.store,
    device: backend.device,
    catalog: TIER1_CATALOG,
    // Builders size headers and footings from the same resolved loads the solver checks.
    siteDefaults,
    notify: note,
    ...(backend.sync ? { sync: backend.sync } : {}),
    ...(backend.user ? { user: backend.user, auth: backend.auth } : {}),
    isBusy: () => useChatStore.getState().running !== null,
  });
  if (backend.adopted > 0) note(movedNote(backend.adopted));
  if (backend.user) {
    // Signed out elsewhere, or the session was revoked: save what's here and show the card again.
    backend.auth.onChange((user) => {
      if (user) return;
      void (projects.current?.flush() ?? Promise.resolve()).finally(() => window.location.reload());
    });
  }

  const fetchImpl = window.fetch.bind(window);
  const voice = createWebSpeechVoice(window);
  // The signed-in user's token for the Claude server (hosted copy); nothing for local-only.
  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await backend.accessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // One status fetch at startup, shared by the chat and the site defaults: the default
  // location (SLAPDASH_DEFAULT_LOCATION) comes from the server, never the bundle.
  let firstStatus: ReturnType<typeof fetchKeyholeStatus> | null = fetchKeyholeStatus(fetchImpl, undefined, authHeaders);
  void firstStatus.then((status) => useSiteStore.getState().setDefaultLocation(status?.defaultLocation ?? null));

  const chat = createChatController({
    client: fetchKeyholeClient({ fetch: fetchImpl, headers: authHeaders }),
    getStatus: () => {
      const shared = firstStatus;
      firstStatus = null;
      return shared ?? fetchKeyholeStatus(fetchImpl, undefined, authHeaders);
    },
    analysis: (project) => analyzeProject(project, { siteDefaults: useSiteStore.getState().siteDefaults }, 'claude'),
    siteDefaults: () => useSiteStore.getState().siteDefaults,
    photos: createPhotoStore({
      files: () => (projects.current ? { store: backend.store.files, projectId: projects.current.id } : null),
    }),
    preparePhoto,
    snapshot: browserSnapshotProvider,
    openSample: () => void projects.openSample(),
    onChatChanged: (log) => projects.onChatChanged(log),
    chatLogFor: (bus) => projects.chatLogFor(bus),
    voice,
    onSignedOut: () => {
      // The Claude server refused the token. If the session here is gone too, show the card.
      void backend.auth.currentUser().then((user) => {
        if (!user) window.location.reload();
      });
    },
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

  reactRoot.render(
    <StrictMode>
      <ProjectsProvider controller={projects}>
        <ChatProvider controller={chat}>
          <App actions={actions} />
        </ChatProvider>
      </ProjectsProvider>
    </StrictMode>,
  );
  void registerServiceWorker();
}

boot().catch((error: unknown) => {
  console.error(error);
  rootEl.textContent = `Slapdash couldn't start: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`;
});
