import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSpeechVoice, FINISH_TIMEOUT_MS, type SpeechRecognitionLike, type SpeechWindow } from '../../src/voice/web-speech.ts';
import type { Heard, VoiceError } from '../../src/voice/voice-provider.ts';

type Result = { isFinal: boolean; length: number; 0: { transcript: string } };
const result = (transcript: string, isFinal: boolean): Result => ({ isFinal, length: 1, 0: { transcript } });

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  starts = 0;
  stops = 0;
  aborts = 0;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.starts++;
  }
  stop() {
    this.stops++;
  }
  abort() {
    this.aborts++;
  }
  results(...list: Result[]) {
    this.onresult?.({ results: Object.assign([...list], { length: list.length }) });
  }
  error(error: string) {
    this.onerror?.({ error });
  }
  end() {
    this.onend?.();
  }
}

class FakeUtterance {
  lang = '';
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

function stubWindow(opts: { secure?: boolean; recognition?: boolean; synthesis?: boolean } = {}) {
  FakeRecognition.instances = [];
  const spoken: FakeUtterance[] = [];
  const synth = { speak: vi.fn((u: FakeUtterance) => spoken.push(u)), cancel: vi.fn() };
  const visibility = new Set<() => void>();
  const doc = { visibilityState: 'visible', addEventListener: (_t: string, cb: () => void) => visibility.add(cb) };
  const win: SpeechWindow = {
    isSecureContext: opts.secure ?? true,
    navigator: { language: 'en-US' },
    document: doc,
    ...(opts.recognition === false ? {} : { webkitSpeechRecognition: FakeRecognition }),
    ...(opts.synthesis === false ? {} : { speechSynthesis: synth as unknown as SpeechWindow['speechSynthesis'], SpeechSynthesisUtterance: FakeUtterance }),
  };
  const hide = () => {
    doc.visibilityState = 'hidden';
    for (const cb of visibility) cb();
  };
  return { win, synth, spoken, hide, rec: () => FakeRecognition.instances.at(-1)! };
}

function handlers() {
  const heard: Heard[] = [];
  const errors: VoiceError[] = [];
  return { heard, errors, h: { onHeard: (x: Heard) => heard.push(x), onError: (e: VoiceError) => errors.push(e), onStopped: vi.fn() } };
}

afterEach(() => vi.useRealTimers());

describe('web speech: support', () => {
  it('listens and speaks where both APIs exist in a secure context', () => {
    expect(createWebSpeechVoice(stubWindow().win).support).toEqual({ listen: true, speak: true });
  });
  it('cannot listen without the recognition API', () => {
    expect(createWebSpeechVoice(stubWindow({ recognition: false }).win).support.listen).toBe(false);
  });
  it('cannot listen outside a secure context', () => {
    expect(createWebSpeechVoice(stubWindow({ secure: false }).win).support.listen).toBe(false);
  });
  it('cannot speak without speech synthesis', () => {
    expect(createWebSpeechVoice(stubWindow({ synthesis: false }).win).support).toEqual({ listen: true, speak: false });
  });
});

describe('web speech: listening', () => {
  it('starts continuous interim recognition, primes speech once and stops speaking', () => {
    const s = stubWindow();
    const voice = createWebSpeechVoice(s.win);
    voice.listen(handlers().h).cancel();
    expect(s.rec()).toMatchObject({ continuous: true, interimResults: true, lang: 'en-US', starts: 1 });
    expect(s.spoken).toHaveLength(1);
    expect(s.spoken[0]).toMatchObject({ text: '', volume: 0 });
    expect(s.synth.cancel).toHaveBeenCalled();
    voice.listen(handlers().h).cancel();
    expect(s.spoken).toHaveLength(1);
  });

  it('rebuilds the words from the whole result list each time', () => {
    const s = stubWindow();
    const { heard, h } = handlers();
    createWebSpeechVoice(s.win).listen(h);
    s.rec().results(result('Add a', false));
    s.rec().results(result('Add a ', true), result('bench', false));
    s.rec().results(result('Add a ', true), result('bench', true));
    expect(heard).toEqual([
      { final: '', interim: 'Add a' },
      { final: 'Add a', interim: 'bench' },
      { final: 'Add a bench', interim: '' },
    ]);
  });

  it('restarts after an early end while held and keeps the earlier words', async () => {
    const s = stubWindow();
    const { heard, h } = handlers();
    const session = createWebSpeechVoice(s.win).listen(h);
    s.rec().results(result('Add a bench', true));
    s.rec().end();
    expect(s.rec().starts).toBe(2);
    s.rec().results(result('by the door', false));
    expect(heard.at(-1)).toEqual({ final: 'Add a bench', interim: 'by the door' });
    const done = session.finish();
    expect(s.rec().stops).toBe(1);
    s.rec().end();
    await expect(done).resolves.toBe('Add a bench by the door');
  });

  it('finish resolves after a timeout when the engine never ends', async () => {
    vi.useFakeTimers();
    const s = stubWindow();
    const session = createWebSpeechVoice(s.win).listen(handlers().h);
    s.rec().results(result('Hello', false));
    const done = session.finish();
    vi.advanceTimersByTime(FINISH_TIMEOUT_MS);
    await expect(done).resolves.toBe('Hello');
    expect(s.rec().aborts).toBe(1);
  });

  it.each([
    ['not-allowed', 'not-allowed'],
    ['service-not-allowed', 'unavailable'],
    ['audio-capture', 'no-mic'],
    ['network', 'network'],
    ['language-not-supported', 'failed'],
  ])('maps %s to %s', (engine, mapped) => {
    const s = stubWindow();
    const voice = createWebSpeechVoice(s.win);
    const { errors, h } = handlers();
    voice.listen(h);
    s.rec().error(engine);
    expect(errors).toEqual([mapped]);
    expect(voice.support.listen).toBe(mapped !== 'unavailable');
  });

  it('ignores no-speech and aborted', () => {
    const s = stubWindow();
    const { errors, h } = handlers();
    createWebSpeechVoice(s.win).listen(h);
    s.rec().error('no-speech');
    s.rec().error('aborted');
    s.rec().end();
    expect(errors).toEqual([]);
    expect(s.rec().starts).toBe(2);
  });

  it('cancel aborts and drops what was heard', async () => {
    const s = stubWindow();
    const { heard, h } = handlers();
    const session = createWebSpeechVoice(s.win).listen(h);
    session.cancel();
    expect(s.rec().aborts).toBe(1);
    s.rec().results(result('late', true));
    expect(heard).toEqual([]);
    await expect(session.finish()).resolves.toBe('');
  });
});

describe('web speech: speaking', () => {
  it('queues utterances and reports speaking from the first start to the last end', () => {
    const s = stubWindow();
    const voice = createWebSpeechVoice(s.win);
    const changes: boolean[] = [];
    voice.onSpeakingChange((x) => changes.push(x));
    voice.speak('One.');
    voice.speak('Two.');
    expect(s.spoken.map((u) => [u.text, u.lang])).toEqual([
      ['One.', 'en-US'],
      ['Two.', 'en-US'],
    ]);
    s.spoken[0]!.onstart?.();
    s.spoken[0]!.onend?.();
    s.spoken[1]!.onstart?.();
    expect(changes).toEqual([true]);
    s.spoken[1]!.onend?.();
    expect(changes).toEqual([true, false]);
  });

  it('stopSpeaking cancels the queue', () => {
    const s = stubWindow();
    const voice = createWebSpeechVoice(s.win);
    const changes: boolean[] = [];
    voice.onSpeakingChange((x) => changes.push(x));
    voice.speak('One.');
    s.spoken[0]!.onstart?.();
    voice.stopSpeaking();
    expect(s.synth.cancel).toHaveBeenCalled();
    expect(changes).toEqual([true, false]);
    s.spoken[0]!.onend?.();
    expect(changes).toEqual([true, false]);
  });

  it('does nothing without speech synthesis', () => {
    const voice = createWebSpeechVoice(stubWindow({ synthesis: false }).win);
    expect(() => voice.speak('Hello')).not.toThrow();
  });

  it('the page hiding stops speech and listening', async () => {
    const s = stubWindow();
    const voice = createWebSpeechVoice(s.win);
    const { h } = handlers();
    const changes: boolean[] = [];
    voice.onSpeakingChange((x) => changes.push(x));
    const session = voice.listen(h);
    voice.speak('One.');
    s.spoken.at(-1)!.onstart?.();
    s.hide();
    expect(changes).toEqual([true, false]);
    expect(s.rec().aborts).toBe(1);
    expect(h.onStopped).toHaveBeenCalledOnce();
    await expect(session.finish()).resolves.toBe('');
  });
});
