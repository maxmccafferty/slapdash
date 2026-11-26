/**
 * The seam between the chat and a speech engine (ADR-0002 §E4). The browser's Web Speech API
 * is the only provider today (`web-speech.ts`); a premium provider can slot in behind this.
 */

/** What this browser can do. `listen` can turn false at runtime (Safari's `service-not-allowed`). */
export interface VoiceSupport {
  listen: boolean;
  speak: boolean;
}

/** Everything heard so far: confirmed words and the unconfirmed tail. */
export interface Heard {
  final: string;
  interim: string;
}

export type VoiceError = 'not-allowed' | 'unavailable' | 'no-mic' | 'network' | 'failed';

export interface ListenHandlers {
  onHeard(heard: Heard): void;
  /** Fatal for this session of listening; 'unavailable' means never again on this page. */
  onError(error: VoiceError): void;
  /** The provider stopped listening on its own (the page was hidden); nothing will be sent. */
  onStopped?(): void;
}

export interface Listening {
  /** Stop and resolve with everything heard (final + last interim), after the engine's end or a timeout. */
  finish(): Promise<string>;
  /** Stop and drop everything. */
  cancel(): void;
}

export interface VoiceProvider {
  readonly support: VoiceSupport;
  /** Must be called synchronously inside a user gesture (iOS). Also primes speech output. */
  listen(handlers: ListenHandlers): Listening;
  /** Queue an utterance. No-op when speech isn't supported. */
  speak(text: string): void;
  stopSpeaking(): void;
  /** Called with true when the queue starts speaking, false when it empties or is cancelled. */
  onSpeakingChange(cb: (speaking: boolean) => void): () => void;
}
