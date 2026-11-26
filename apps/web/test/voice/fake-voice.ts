import type { Heard, ListenHandlers, VoiceError, VoiceProvider, VoiceSupport } from '../../src/voice/voice-provider.ts';

/** A scriptable `VoiceProvider`: tests push what was "heard" and read what was "spoken". */
export interface FakeVoice extends VoiceProvider {
  readonly support: VoiceSupport;
  /** Every utterance queued, in order. */
  spoken: string[];
  listenCalls: number;
  stopSpeakingCalls: number;
  readonly listening: boolean;
  readonly speaking: boolean;
  hear(heard: Heard): void;
  fail(error: VoiceError): void;
  /** The provider stops by itself (the page was hidden). */
  hide(): void;
  /** The speech queue empties. */
  finishSpeaking(): void;
}

export function fakeVoice(support: Partial<VoiceSupport> = {}): FakeVoice {
  const sup: VoiceSupport = { listen: true, speak: true, ...support };
  let handlers: ListenHandlers | null = null;
  let heard: Heard = { final: '', interim: '' };
  let speaking = false;
  const listeners = new Set<(speaking: boolean) => void>();
  const setSpeaking = (next: boolean) => {
    if (speaking === next) return;
    speaking = next;
    for (const cb of listeners) cb(next);
  };

  const fake: FakeVoice = {
    support: sup,
    spoken: [],
    listenCalls: 0,
    stopSpeakingCalls: 0,
    get listening() {
      return handlers !== null;
    },
    get speaking() {
      return speaking;
    },
    listen(h) {
      fake.listenCalls++;
      fake.stopSpeaking();
      handlers = h;
      heard = { final: '', interim: '' };
      return {
        finish: async () => {
          if (handlers !== h) return '';
          handlers = null;
          return `${heard.final} ${heard.interim}`.replace(/\s+/g, ' ').trim();
        },
        cancel: () => {
          if (handlers === h) handlers = null;
        },
      };
    },
    speak(text) {
      if (!sup.speak) return;
      fake.spoken.push(text);
      setSpeaking(true);
    },
    stopSpeaking() {
      fake.stopSpeakingCalls++;
      setSpeaking(false);
    },
    onSpeakingChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    hear(next) {
      heard = next;
      handlers?.onHeard(next);
    },
    fail(error) {
      const h = handlers;
      handlers = null;
      if (error === 'unavailable') sup.listen = false;
      h?.onError(error);
    },
    hide() {
      const h = handlers;
      handlers = null;
      fake.stopSpeaking();
      h?.onStopped?.();
    },
    finishSpeaking() {
      setSpeaking(false);
    },
  };
  return fake;
}
