/**
 * The chat's behaviour, framework-free: it runs agent turns (`runTurn`) against the bus the
 * model store follows and turns the loop's events and errors into chat-store updates. React
 * components only read the store and call these methods, so a turn keeps running when the
 * phone sheet closes.
 *
 * One `AgentMemory` per bus: opening another project (a new bus) starts a fresh chat.
 */
import {
  AgentMemory,
  KeyholeRequestError,
  KeyholeStreamFailure,
  runTurn,
  type AgentEvent,
  type BudgetStatus,
  type ChatLogLike,
  type KeyholeClient,
  type KeyholeStatus,
  type AnalysisProvider,
  type SnapshotProvider,
  type StoredBlock,
  type StressContext,
  type TurnCaps,
  type TurnResult,
  type UserInput,
} from '@slapdash/agent';
import type { CommandBus, SiteDefaults } from '@slapdash/core';
import { useModelStore } from '../state/model-store.ts';
import { addNote, answerPending, finishTurn, updateClaude, useChatStore, type ChatState } from '../state/chat-store.ts';
import { emptyClaudeItem, type ChatItem, type PointerChip } from './chat-types.ts';
import type { PhotoStore, PreparedPhoto } from './photos.ts';
import { speechText } from '../voice/speech-text.ts';
import type { Listening, VoiceError, VoiceProvider } from '../voice/voice-provider.ts';

/** The outline height when a plan gives a footprint but no height: 9 ft. */
export const DEFAULT_PLAN_HEIGHT_MM = 2743;

export interface ChatControllerDeps {
  client: KeyholeClient;
  /** `GET /api/claude`; null when it can't be read. */
  getStatus: () => Promise<KeyholeStatus | null>;
  photos: PhotoStore;
  preparePhoto: (file: File) => Promise<PreparedPhoto>;
  snapshot?: SnapshotProvider;
  /** Runs the structural check for Claude's check_structure. */
  analysis?: AnalysisProvider;
  /** The app's site defaults (default location, loads table), for the `<project>` summary. */
  siteDefaults?: () => SiteDefaults | undefined;
  /** Opens the sample pool house (a new bus). */
  openSample?: () => void;
  /** Where the chat log is saved once project storage is wired in. */
  onChatChanged?: (log: ChatLogLike) => void;
  caps?: Partial<TurnCaps>;
  newTurnId?: () => string;
  /** Hold-to-talk and spoken replies; without it Talk is hidden. */
  voice?: VoiceProvider;
}

export interface SendOptions {
  approvePlan?: boolean;
  /** The message was spoken: Claude's reply is read aloud. */
  spoken?: boolean;
  /** The automatic stress turn: what the stress view shows. */
  stress?: StressContext;
}

export interface ChatController {
  start(): Promise<void>;
  send(text: string, opts?: SendOptions): Promise<TurnResult | null>;
  approvePlan(): Promise<TurnResult | null>;
  /**
   * The automatic turn when Stress is switched on and shows something worth a word: Claude
   * calls check_structure, explains, and offers the fix. Only when connected and idle.
   */
  explainStress(ctx: StressContext): Promise<TurnResult | null>;
  changePlan(): void;
  chooseOption(itemId: string, text: string): Promise<TurnResult | null>;
  undoTurn(itemId: string): void;
  /** Whether a turn's Undo key can be used now: its step is the latest and nothing is running. */
  canUndo(entryId: number): boolean;
  /** Stops the turn in flight and any reply being read aloud. */
  stop(): void;
  /** Talk pressed. Runs synchronously inside the gesture: iOS needs `listen` called there. */
  startTalking(): void;
  /** Talk let go: sends what was heard as a spoken message. */
  stopTalking(): Promise<void>;
  stopSpeaking(): void;
  attachPhoto(file: File): Promise<void>;
  removePhoto(fileId: string): void;
  openSample(): void;
  dispose(): void;
}

const set = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => useChatStore.setState(partial);
const get = () => useChatStore.getState();

let itemCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++itemCounter}`;

/** "December 1": the reset is midnight UTC, so the date is read in UTC. */
export function formatResetDate(resetsAt: string): string {
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return 'the first of next month';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export function warningNote(b: BudgetStatus): string {
  return `${Math.round(b.fraction * 100)}% of this month's Claude budget is used: ${usd(b.spentUsd)} of ${usd(b.capUsd)}.`;
}

function textOf(content: readonly StoredBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

/** The newest change that hasn't been undone, if any. */
function topEntryId(bus: CommandBus): number | null {
  const live = bus.listHistory(Number.MAX_SAFE_INTEGER).filter((i) => !i.isUndone);
  return live.at(-1)?.id ?? null;
}

/** The user line for the automatic stress turn, shown as a compact chip. */
export const STRESS_TRIGGER_TEXT = 'Stress view on';

export const NOTHING_HEARD = "Didn't catch that. Hold Talk while you speak.";

export const VOICE_ERROR_NOTES: Record<VoiceError, string> = {
  'not-allowed': "Slapdash can't use the microphone. Allow it in your browser's settings, or type instead.",
  unavailable: "Talking isn't available here. Type instead.",
  'no-mic': 'No microphone found. Type instead.',
  network: "Couldn't reach speech recognition. Try again or type.",
  failed: 'Talking stopped working. Try again or type.',
};

function errorNote(error: unknown): string {
  if (error instanceof KeyholeRequestError) {
    const f = error.failure;
    if (f.error === 'rate_limited') return `Too many messages. Try again in ${f.retryAfterSeconds} seconds.`;
    if (f.error === 'network') return "Couldn't reach Claude. Check your connection and try again.";
    if (f.error === 'too_large') return 'This conversation is too long to send. Open the project again to start a new chat.';
    return "Claude couldn't answer. Try again.";
  }
  if (error instanceof KeyholeStreamFailure) {
    return error.data.retryable ? "Claude is busy right now. Try again in a minute." : "Claude couldn't answer. Try again.";
  }
  return "Claude couldn't answer. Try again.";
}

export function createChatController(deps: ChatControllerDeps): ChatController {
  let bus: CommandBus | null = useModelStore.getState().bus;
  let memory = newMemory();
  let abort: AbortController | null = null;

  const voice = deps.voice;
  /** The hold-to-talk session in progress, if any. */
  let talking: Listening | null = null;
  set({ voice: voice ? { ...voice.support } : { listen: false, speak: false } });
  const offSpeaking = voice?.onSpeakingChange((speaking) => set({ speaking })) ?? (() => {});

  /** Drop any listening and any speech: Stop, a new project, dispose. */
  function silence() {
    talking?.cancel();
    talking = null;
    voice?.stopSpeaking();
    set({ listening: null });
  }

  function newMemory() {
    return new AgentMemory(undefined, { loadFile: (id) => deps.photos.loadFile(id) });
  }

  // A new bus is a new project: a new conversation.
  const offModel = useModelStore.subscribe((s, prev) => {
    if (s.bus === prev.bus || s.bus === bus) return;
    bus = s.bus;
    abort?.abort();
    abort = null;
    silence();
    memory = newMemory();
    deps.photos.revokeAll();
    set({ items: [], running: null, pendingPhotos: [], changingPlan: false, draft: '' });
  });

  function applyBudget(budget: BudgetStatus) {
    set((s) => {
      const out: Partial<ChatState> = { budget };
      if (budget.state === 'warning' && !s.warned) {
        out.warned = true;
        out.items = addNote(s.items, warningNote(budget));
      }
      return out;
    });
  }

  /** True once the keyhole has said Claude is configured. Unprompted turns need it; a typed send doesn't. */
  let keyholeConfirmed = false;

  function applyStatus(status: KeyholeStatus | null) {
    keyholeConfirmed = status?.configured === true;
    if (!status) {
      set({ connection: 'ready' });
      return;
    }
    applyBudget(status.budget);
    if (!status.configured) set({ connection: 'not_configured' });
    else if (status.budget.state === 'capped') set({ connection: 'capped' });
    else set({ connection: 'ready' });
  }

  function pointer(): PointerChip | null {
    const m = useModelStore.getState();
    if (!m.selectedPartId || !m.selectedPartLabel) return null;
    const part = m.project?.parts[m.selectedPartId];
    const swatch = part ? m.catalog?.materials.get(part.materialId)?.swatch : undefined;
    return { id: m.selectedPartId, label: m.selectedPartLabel, swatch: swatch ? { color: swatch.color } : null };
  }

  async function send(rawText: string, opts: SendOptions = {}): Promise<TurnResult | null> {
    const s = get();
    const text = rawText.trim();
    if (s.running || !bus) return null;
    if (s.connection !== 'ready' && s.connection !== 'checking') return null;
    if (text === '' && s.pendingPhotos.length === 0) return null;

    // A new message interrupts a reply being read aloud; only a spoken one gets a spoken reply.
    voice?.stopSpeaking();
    const speak = (t: string) => {
      if (voice && opts.spoken && get().voice.speak) voice.speak(speechText(t));
    };

    const turnBus = bus;
    const turnMemory = memory;
    const pointedAt = opts.stress ? null : pointer();
    const photos = s.pendingPhotos;
    const approvePlan = opts.approvePlan ?? (s.changingPlan ? false : undefined);
    const planAnswer = approvePlan === false ? 'changing' : 'approved';

    const userItem: ChatItem = {
      kind: 'user',
      id: nextId('user'),
      text,
      photos,
      ...(pointedAt ? { pointer: pointedAt } : {}),
      ...(opts.stress ? { trigger: 'stress' as const } : {}),
    };
    const claudeId = nextId('claude');
    set((st) => ({
      items: [...answerPending(st.items, planAnswer), userItem, emptyClaudeItem(claudeId)],
      running: { turnId: null, itemId: claudeId, working: false },
      draft: '',
      pendingPhotos: [],
      changingPlan: false,
    }));
    if (pointedAt) useModelStore.getState().select(null);
    useModelStore.getState().setProposal(null);

    // Parts that appear during the turn get a brief orange outline.
    const known = new Set(Object.keys(turnBus.project.parts));
    const offBus = turnBus.subscribe((project) => {
      const added = Object.keys(project.parts).filter((id) => !known.has(id));
      for (const id of added) known.add(id);
      if (added.length > 0) useModelStore.getState().markInProgress(added);
    });

    // Text streams in per message; finished messages are joined with a blank line.
    const said: string[] = [];
    let current = '';
    const showText = () => {
      const text = [...said, current].filter((t) => t.trim() !== '').join('\n\n');
      set((st) => ({ items: updateClaude(st.items, claudeId, (item) => ({ ...item, text })) }));
    };
    const setWorking = (working: boolean) =>
      set((st) => (st.running && st.running.itemId === claudeId && st.running.working !== working ? { running: { ...st.running, working } } : {}));

    const onEvent = (e: AgentEvent) => {
      if (abort !== controller) return;
      switch (e.type) {
        case 'text_delta':
          current += e.text;
          setWorking(false);
          showText();
          break;
        case 'assistant_message': {
          const t = textOf(e.content);
          if (t.trim() !== '') {
            said.push(t);
            speak(t);
          }
          current = '';
          showText();
          break;
        }
        case 'tool_start':
          setWorking(true);
          break;
        case 'plan': {
          const plan = e.plan;
          speak(plan.text);
          set((st) => ({ items: updateClaude(st.items, claudeId, (item) => ({ ...item, plan: { text: plan.text, state: 'pending' } })) }));
          if (plan.footprint) {
            useModelStore.getState().setProposal({ footprint: plan.footprint, height_mm: plan.height_mm ?? DEFAULT_PLAN_HEIGHT_MM });
          }
          break;
        }
        case 'photo_request': {
          const what = e.what;
          set((st) => ({ items: updateClaude(st.items, claudeId, (item) => ({ ...item, photoRequest: { what, state: 'pending' } })) }));
          break;
        }
        case 'options': {
          const choices = e.options;
          set((st) => ({ items: updateClaude(st.items, claudeId, (item) => ({ ...item, options: { choices, state: 'pending' } })) }));
          break;
        }
        case 'budget':
          applyBudget(e.budget);
          break;
      }
    };

    const controller = new AbortController();
    abort = controller;
    const topBefore = topEntryId(turnBus);
    const input: UserInput = { text, ...(approvePlan !== undefined ? { approvePlan } : {}) };
    if (photos.length > 0) input.photos = photos.map((p) => ({ fileId: p.fileId, mimeType: p.mimeType }));
    if (pointedAt) input.pointedAt = { id: pointedAt.id, label: pointedAt.label };
    if (opts.stress) input.stress = opts.stress;
    const siteDefaults = deps.siteDefaults?.();

    let result: TurnResult | null = null;
    try {
      result = await runTurn(
        {
          bus: turnBus,
          client: deps.client,
          memory: turnMemory,
          signal: controller.signal,
          onEvent,
          ...(deps.snapshot ? { snapshot: deps.snapshot } : {}),
          ...(deps.analysis ? { analysis: deps.analysis } : {}),
          ...(siteDefaults ? { siteDefaults } : {}),
          ...(deps.caps ? { caps: deps.caps } : {}),
          ...(deps.newTurnId ? { newTurnId: deps.newTurnId } : {}),
        },
        input,
      );
    } catch (error) {
      if (abort === controller) handleError(error, controller.signal.aborted);
    } finally {
      offBus();
    }

    // The project changed under us (another project was opened): this turn's chat is gone.
    if (abort !== controller) return result;
    abort = null;

    const top = topEntryId(turnBus);
    const historyEntryId = result ? result.historyEntryId : top !== topBefore ? top : null;
    const notes = [...(result?.notes ?? [])];
    if (result?.aborted) notes.push('Stopped.');
    set((st) => {
      const out: Partial<ChatState> = {
        items: finishTurn(
          updateClaude(st.items, claudeId, (item) => ({ ...item, turnId: result?.turnId ?? item.turnId })),
          claudeId,
          { historyEntryId, notes },
        ),
        running: null,
      };
      if (st.connection === 'ready' && st.budget?.state === 'capped') out.connection = 'capped';
      return out;
    });
    deps.onChatChanged?.(turnMemory.toChatLog());
    return result;
  }

  function handleError(error: unknown, aborted: boolean) {
    if (aborted) {
      set((st) => ({ items: addNote(st.items, 'Stopped.') }));
      return;
    }
    if (error instanceof KeyholeRequestError) {
      const f = error.failure;
      if (f.error === 'budget_capped') {
        set({ connection: 'capped', budget: f.budget });
        return;
      }
      if (f.error === 'not_configured') {
        set({ connection: 'not_configured' });
        return;
      }
    }
    set((st) => ({ items: addNote(st.items, errorNote(error)) }));
  }

  function voiceError(session: Listening, error: VoiceError) {
    if (talking !== session) return;
    talking = null;
    set((st) => ({
      listening: null,
      items: addNote(st.items, VOICE_ERROR_NOTES[error]),
      ...(error === 'unavailable' ? { voice: { ...st.voice, listen: false } } : {}),
    }));
  }

  function startTalking() {
    const s = get();
    if (!voice || !s.voice.listen || s.running || talking || !bus) return;
    if (s.connection !== 'ready' && s.connection !== 'checking') return;
    // No await before `listen`: iOS only allows the microphone and speech inside the gesture.
    const session: Listening = voice.listen({
      onHeard: (heard) => {
        if (talking === session) set({ listening: { heard: heard.final, unconfirmed: heard.interim } });
      },
      onError: (error) => voiceError(session, error),
      onStopped: () => {
        if (talking !== session) return;
        talking = null;
        set({ listening: null });
      },
    });
    talking = session;
    set({ listening: { heard: '', unconfirmed: '' } });
  }

  async function stopTalking() {
    const session = talking;
    if (!session) return;
    const text = await session.finish();
    // Cancelled, failed or replaced while finishing: nothing to send.
    if (talking !== session) return;
    talking = null;
    set({ listening: null });
    if (text.trim() === '') {
      set((st) => ({ items: addNote(st.items, NOTHING_HEARD) }));
      return;
    }
    // The typed draft stays as it was.
    const draft = get().draft;
    const sending = send(text, { spoken: true });
    if (draft !== '') set({ draft });
    await sending;
  }

  function canUndo(entryId: number): boolean {
    return bus !== null && get().running === null && topEntryId(bus) === entryId;
  }

  function findItem(id: string) {
    return get().items.find((i) => i.id === id);
  }

  return {
    async start() {
      applyStatus(await deps.getStatus());
    },

    send,

    approvePlan() {
      return send('Build it', { approvePlan: true });
    },

    explainStress(ctx) {
      const s = get();
      // Never an unprompted paid turn without a confirmed keyhole (a static preview has none).
      if (!keyholeConfirmed || s.running || s.connection !== 'ready' || talking) return Promise.resolve(null);
      // A pointer chip would make "this" mean the tapped part; the stress turn is about the view.
      return send(STRESS_TRIGGER_TEXT, { stress: ctx });
    },

    changePlan() {
      set((st) => ({
        items: st.items.map((item) =>
          item.kind === 'claude' && item.plan?.state === 'pending' ? { ...item, plan: { ...item.plan, state: 'changing' } } : item,
        ),
        changingPlan: true,
        focusRequest: st.focusRequest + 1,
      }));
      useModelStore.getState().setProposal(null);
    },

    chooseOption(itemId, text) {
      const item = findItem(itemId);
      if (get().running || item?.kind !== 'claude' || item.options?.state !== 'pending') return Promise.resolve(null);
      const sending = send(text);
      set((st) => ({
        items: updateClaude(st.items, itemId, (it) => (it.options ? { ...it, options: { ...it.options, chosen: text } } : it)),
      }));
      return sending;
    },

    canUndo,

    undoTurn(itemId) {
      const item = findItem(itemId);
      if (!bus || item?.kind !== 'claude' || !item.undo || item.undo.state !== 'available') return;
      if (!canUndo(item.undo.entryId)) return;
      const res = bus.undo();
      if (!res.ok) return;
      set((st) => ({ items: updateClaude(st.items, itemId, (it) => (it.undo ? { ...it, undo: { ...it.undo, state: 'undone' } } : it)) }));
    },

    stop() {
      abort?.abort();
      voice?.stopSpeaking();
    },

    startTalking,
    stopTalking,

    stopSpeaking() {
      voice?.stopSpeaking();
    },

    async attachPhoto(file) {
      const asked = get().items.some((i) => i.kind === 'claude' && i.photoRequest?.state === 'pending');
      if (!asked) return;
      try {
        const prepared = await deps.preparePhoto(file);
        const stored = await deps.photos.put(prepared);
        set((st) => ({ pendingPhotos: [...st.pendingPhotos, stored] }));
      } catch {
        set((st) => ({ items: addNote(st.items, "That photo couldn't be read. Try another one.") }));
      }
    },

    removePhoto(fileId) {
      deps.photos.remove(fileId);
      set((st) => ({ pendingPhotos: st.pendingPhotos.filter((p) => p.fileId !== fileId) }));
    },

    openSample() {
      deps.openSample?.();
    },

    dispose() {
      offModel();
      offSpeaking();
      abort?.abort();
      silence();
    },
  };
}

