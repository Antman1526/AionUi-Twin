import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StubUtterance = {
  text: string;
  rate?: number;
  pitch?: number;
  voice?: { voiceURI: string } | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

let lastUtterance: StubUtterance | null = null;
let speakMock: ReturnType<typeof vi.fn>;
let cancelMock: ReturnType<typeof vi.fn>;
let getVoicesMock: ReturnType<typeof vi.fn>;
let synthStub: {
  speak: typeof speakMock;
  cancel: typeof cancelMock;
  getVoices: typeof getVoicesMock;
  speaking: boolean;
  pending: boolean;
};

const VOICES = [
  { voiceURI: 'voice-a', name: 'Voice A', lang: 'en-US' },
  { voiceURI: 'voice-b', name: 'Voice B', lang: 'fr-FR' },
];

beforeEach(() => {
  lastUtterance = null;
  speakMock = vi.fn((utterance: StubUtterance) => {
    lastUtterance = utterance;
  });
  cancelMock = vi.fn();
  getVoicesMock = vi.fn(() => VOICES);
  synthStub = { speak: speakMock, cancel: cancelMock, getVoices: getVoicesMock, speaking: false, pending: false };

  vi.stubGlobal('speechSynthesis', synthStub);
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      rate?: number;
      pitch?: number;
      voice?: { voiceURI: string } | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('TextToSpeechService', () => {
  it('reports support based on the presence of speechSynthesis', async () => {
    const { isTextToSpeechSupported } = await import('@/renderer/services/TextToSpeechService');
    expect(isTextToSpeechSupported()).toBe(true);
  });

  it('lists system voices from speechSynthesis.getVoices()', async () => {
    const { listVoices } = await import('@/renderer/services/TextToSpeechService');
    expect(listVoices()).toEqual(VOICES);
  });

  it('speaks text with the selected voice and rate, resolving on onend', async () => {
    const { speak } = await import('@/renderer/services/TextToSpeechService');

    const promise = speak('Hello there', { voiceURI: 'voice-b', rate: 1.5 });
    expect(cancelMock).toHaveBeenCalled();
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(lastUtterance?.text).toBe('Hello there');
    expect(lastUtterance?.rate).toBe(1.5);
    expect(lastUtterance?.voice).toEqual(VOICES[1]);

    lastUtterance?.onend?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when the utterance reports a real error', async () => {
    const { speak } = await import('@/renderer/services/TextToSpeechService');

    const promise = speak('Hello there');
    lastUtterance?.onerror?.({ error: 'synthesis-failed' });
    await expect(promise).rejects.toThrow('TTS_SPEAK_FAILED:synthesis-failed');
  });

  it('resolves quietly when the utterance is cancelled or interrupted', async () => {
    const { speak } = await import('@/renderer/services/TextToSpeechService');

    const promise = speak('Hello there');
    lastUtterance?.onerror?.({ error: 'canceled' });
    await expect(promise).resolves.toBeUndefined();
  });

  it('strips markdown before speaking', async () => {
    const { speak } = await import('@/renderer/services/TextToSpeechService');

    const promise = speak('# Title\n\nSome **bold** text with a [link](https://example.com) and `code`.');
    expect(lastUtterance?.text).toBe('Title\nSome bold text with a link and code.');
    lastUtterance?.onend?.();
    await promise;
  });

  it('resolves without speaking when the stripped text is empty', async () => {
    const { speak } = await import('@/renderer/services/TextToSpeechService');
    await expect(speak('```\ncode only\n```')).resolves.toBeUndefined();
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('cancel() stops in-progress speech', async () => {
    const { cancel } = await import('@/renderer/services/TextToSpeechService');
    cancel();
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it('isSpeaking() reflects the underlying synthesis state', async () => {
    const { isSpeaking } = await import('@/renderer/services/TextToSpeechService');
    synthStub.speaking = true;
    expect(isSpeaking()).toBe(true);
    synthStub.speaking = false;
    synthStub.pending = true;
    expect(isSpeaking()).toBe(true);
    synthStub.pending = false;
    expect(isSpeaking()).toBe(false);
  });
});
