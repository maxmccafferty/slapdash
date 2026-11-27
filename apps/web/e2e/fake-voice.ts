import type { Page } from '@playwright/test';

/**
 * Headless Chromium has `webkitSpeechRecognition` but it can't hear anything, so the e2e specs
 * swap in fake `SpeechRecognition` and `speechSynthesis` globals before the app loads. The test
 * drives them through `window.__fakeVoice`:
 *
 *   __fakeVoice.hear(final, interim)  results for the running recognition
 *   __fakeVoice.spoken                every utterance's text (the priming one is '')
 *   __fakeVoice.speaking              an utterance has started and not ended
 *   __fakeVoice.endSpeech()           the queue finishes speaking
 *
 * `unsupported: true` deletes the recognition API instead, like Firefox.
 */
export interface FakeVoiceWindow {
  __fakeVoice: {
    hear(final: string, interim: string): void;
    spoken: string[];
    speaking: boolean;
    listening: boolean;
    endSpeech(): void;
  };
}

export async function installFakeVoice(page: Page, opts: { unsupported?: boolean } = {}) {
  await page.addInitScript((unsupported: boolean) => {
    const w = window as unknown as Record<string, unknown>;
    if (unsupported) {
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
      return;
    }

    type Handler = ((e: unknown) => void) | null;
    let current: FakeRecognition | null = null;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: Handler = null;
      onerror: Handler = null;
      onend: (() => void) | null = null;
      start() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the fake tracks the live instance
        current = this;
        state.listening = true;
      }
      stop() {
        state.listening = false;
        setTimeout(() => {
          if (current === this) current = null;
          this.onend?.();
        }, 0);
      }
      abort() {
        this.stop();
      }
    }

    interface Utterance {
      text: string;
      lang: string;
      volume: number;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
    }
    class FakeUtterance implements Utterance {
      text: string;
      lang = '';
      volume = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const queue: Utterance[] = [];
    const synth = {
      speak(u: Utterance) {
        state.spoken.push(u.text);
        queue.push(u);
        if (u.text === '') {
          setTimeout(() => {
            queue.splice(queue.indexOf(u), 1);
            u.onend?.();
          }, 0);
          return;
        }
        state.speaking = true;
        setTimeout(() => u.onstart?.(), 0);
      },
      cancel() {
        queue.length = 0;
        state.speaking = false;
      },
      getVoices: () => [],
    };

    const state = {
      spoken: [] as string[],
      speaking: false,
      listening: false,
      hear(final: string, interim: string) {
        const results: unknown[] = [];
        if (final) results.push(Object.assign([{ transcript: final }], { isFinal: true }));
        if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
        current?.onresult?.({ results, resultIndex: 0 });
      },
      endSpeech() {
        const done = queue.splice(0);
        state.speaking = false;
        for (const u of done) u.onend?.();
      },
    };

    Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    w.__fakeVoice = state;
  }, opts.unsupported ?? false);
}
