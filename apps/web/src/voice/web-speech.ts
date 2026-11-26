/**
 * The browser's Web Speech API as a `VoiceProvider`: `SpeechRecognition` for hold-to-talk and
 * `speechSynthesis` for spoken replies. TypeScript's DOM lib has no usable recognition types,
 * so the small surface used here is typed locally.
 */
import type { Heard, ListenHandlers, Listening, VoiceError, VoiceProvider, VoiceSupport } from './voice-provider.ts';

interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult;
}
export interface RecognitionEventLike {
  readonly results: RecognitionResultList;
}
export interface RecognitionErrorEventLike {
  readonly error: string;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

interface UtteranceLike {
  lang: string;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
interface SynthesisLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
}

/** The parts of `window` this provider reads. */
export interface SpeechWindow {
  isSecureContext: boolean;
  navigator: { language?: string };
  document: { visibilityState: string; addEventListener(type: 'visibilitychange', cb: () => void): void };
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
  speechSynthesis?: SynthesisLike;
  SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
}

/** How long `finish()` waits for the engine's `end` before resolving with what it has. */
export const FINISH_TIMEOUT_MS = 1500;

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

function mapError(error: string): VoiceError | null {
  switch (error) {
    case 'no-speech':
    case 'aborted':
      return null;
    case 'not-allowed':
      return 'not-allowed';
    case 'service-not-allowed':
      return 'unavailable';
    case 'audio-capture':
      return 'no-mic';
    case 'network':
      return 'network';
    default:
      return 'failed';
  }
}

export function createWebSpeechVoice(win: Window | SpeechWindow): VoiceProvider {
  const w = win as unknown as SpeechWindow;
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const synth = w.speechSynthesis;
  const Utterance = w.SpeechSynthesisUtterance;
  const support: VoiceSupport = {
    listen: !!w.isSecureContext && typeof Recognition === 'function',
    speak: !!synth && typeof Utterance === 'function',
  };
  const lang = w.navigator.language || 'en-US';

  // Utterances are held until they end: Safari drops `onend` for ones it garbage-collects.
  const queue = new Set<UtteranceLike>();
  let started = false;
  let primed = false;
  const speakingListeners = new Set<(speaking: boolean) => void>();
  const emit = (speaking: boolean) => {
    for (const cb of speakingListeners) cb(speaking);
  };
  let active: { cancel(): void; stopped(): void } | null = null;

  function stopSpeaking() {
    if (!synth) return;
    const was = started || queue.size > 0;
    for (const u of queue) {
      u.onstart = u.onend = u.onerror = null;
    }
    queue.clear();
    synth.cancel();
    started = false;
    if (was) emit(false);
  }

  function speak(text: string) {
    if (!support.speak || !synth || !Utterance || text.trim() === '') return;
    const u = new Utterance(text);
    u.lang = lang;
    const done = () => {
      if (!queue.delete(u)) return;
      if (queue.size === 0 && started) {
        started = false;
        emit(false);
      }
    };
    u.onstart = () => {
      if (!queue.has(u) || started) return;
      started = true;
      emit(true);
    };
    u.onend = done;
    u.onerror = done;
    queue.add(u);
    synth.speak(u);
  }

  function prime() {
    if (primed || !support.speak || !synth || !Utterance) return;
    primed = true;
    // iOS only lets speech play later if a gesture started some first.
    const u = new Utterance('');
    u.volume = 0;
    synth.speak(u);
  }

  function listen(handlers: ListenHandlers): Listening {
    stopSpeaking();
    prime();
    active?.cancel();

    if (!support.listen || !Recognition) {
      queueMicrotask(() => handlers.onError('unavailable'));
      return { finish: async () => '', cancel: () => {} };
    }

    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    let prefix = '';
    let final = '';
    let interim = '';
    let holding = true;
    let dead = false;
    let cancelled = false;
    let resolveFinish: ((text: string) => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let h: ListenHandlers | null = handlers;

    const all = () => tidy(`${prefix} ${final} ${interim}`);
    const settle = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const resolve = resolveFinish;
      resolveFinish = null;
      dead = true;
      rec.onresult = rec.onerror = rec.onend = null;
      h = null;
      if (active === session) active = null;
      resolve?.(all());
    };

    rec.onresult = (event) => {
      // Rebuild from the whole list each time: Chrome's resultIndex sometimes repeats results.
      let f = '';
      let i = '';
      for (let n = 0; n < event.results.length; n++) {
        const result = event.results[n]!;
        const t = result[0]?.transcript ?? '';
        if (result.isFinal) f += t;
        else i += t;
      }
      final = f;
      interim = i;
      h?.onHeard({ final: tidy(`${prefix} ${final}`), interim: tidy(interim) } satisfies Heard);
    };
    rec.onerror = (event) => {
      const error = mapError(event.error);
      if (!error) return;
      if (error === 'unavailable') support.listen = false;
      const target = h;
      dead = true;
      holding = false;
      if (resolveFinish) {
        settle();
      } else {
        rec.onresult = rec.onerror = rec.onend = null;
        h = null;
        if (active === session) active = null;
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
      }
      target?.onError(error);
    };
    rec.onend = () => {
      if (dead) return;
      if (holding) {
        // Safari and Chrome stop on silence: keep what was heard and listen again.
        prefix = tidy(`${prefix} ${final}`);
        final = '';
        interim = '';
        try {
          rec.start();
        } catch {
          /* it may still be ending; the next end retries */
        }
        return;
      }
      settle();
    };

    const session: Listening & { stopped(): void } = {
      finish() {
        if (dead) return Promise.resolve(cancelled ? '' : all());
        holding = false;
        return new Promise<string>((resolve) => {
          resolveFinish = resolve;
          timer = setTimeout(() => {
            try {
              rec.abort();
            } catch {
              /* ignore */
            }
            settle();
          }, FINISH_TIMEOUT_MS);
          try {
            rec.stop();
          } catch {
            settle();
          }
        });
      },
      cancel() {
        if (dead) return;
        holding = false;
        dead = true;
        cancelled = true;
        if (timer) clearTimeout(timer);
        rec.onresult = rec.onerror = rec.onend = null;
        h = null;
        if (active === session) active = null;
        const resolve = resolveFinish;
        resolveFinish = null;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        resolve?.('');
      },
      /** The page was hidden: drop everything and tell the listener. */
      stopped() {
        const target = h;
        session.cancel();
        target?.onStopped?.();
      },
    };
    active = session;
    try {
      rec.start();
    } catch {
      session.cancel();
      queueMicrotask(() => handlers.onError('failed'));
    }
    return session;
  }

  w.document.addEventListener('visibilitychange', () => {
    if (w.document.visibilityState !== 'hidden') return;
    stopSpeaking();
    active?.stopped();
  });

  return {
    support,
    listen,
    speak,
    stopSpeaking,
    onSpeakingChange(cb) {
      speakingListeners.add(cb);
      return () => speakingListeners.delete(cb);
    },
  };
}
