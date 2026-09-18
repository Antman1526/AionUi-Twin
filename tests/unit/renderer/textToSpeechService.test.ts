/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for renderer/services/TextToSpeechService.ts.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancel,
  clampRate,
  isSpeaking,
  listVoices,
  speak,
  stripMarkdownForSpeech,
} from '@/renderer/services/TextToSpeechService';

type FakeVoice = { voiceURI: string; name: string; lang: string };

class FakeUtterance {
  lang = '';
  rate = 1;
  voice: FakeVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

const voices: FakeVoice[] = [
  { voiceURI: 'com.apple.voice.alice', name: 'Alice', lang: 'en-US' },
  { voiceURI: 'com.apple.voice.bob', name: 'Bob', lang: 'de-DE' },
];

const spoken: FakeUtterance[] = [];
const cancelSpy = vi.fn();

const fakeSynthesis = {
  speaking: false,
  cancel: () => {
    fakeSynthesis.speaking = false;
    cancelSpy();
  },
  getVoices: () => voices,
  speak: (utterance: FakeUtterance) => {
    fakeSynthesis.speaking = true;
    spoken.push(utterance);
  },
};

describe('stripMarkdownForSpeech', () => {
  it('drops fenced code blocks entirely', () => {
    const text = 'Before\n\n```ts\nconst a = 1;\n```\n\nAfter';
    expect(stripMarkdownForSpeech(text)).toBe('Before\n\nAfter');
  });

  it('keeps link text and drops the target', () => {
    expect(stripMarkdownForSpeech('See [the docs](https://example.com) now')).toBe('See the docs now');
    expect(stripMarkdownForSpeech('![a diagram](img.png)')).toBe('a diagram');
  });

  it('removes emphasis markers', () => {
    expect(stripMarkdownForSpeech('**bold** and *italic* and _stress_ and __strong__')).toBe(
      'bold and italic and stress and strong'
    );
  });

  it('leaves snake_case identifiers intact', () => {
    expect(stripMarkdownForSpeech('Call read_file_sync on user_id_value')).toBe('Call read_file_sync on user_id_value');
  });

  it('strips heading, quote and list markers', () => {
    expect(stripMarkdownForSpeech('## Title\n- one\n- two\n> quoted')).toBe('Title\none\ntwo\nquoted');
  });

  it('keeps inline code content without the backticks', () => {
    expect(stripMarkdownForSpeech('run `npm test` first')).toBe('run npm test first');
  });

  it('returns an empty string for empty input', () => {
    expect(stripMarkdownForSpeech('')).toBe('');
  });
});

describe('clampRate', () => {
  it('clamps to the supported synthesis range and defaults to 1', () => {
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(9)).toBe(2);
    expect(clampRate(1.4)).toBe(1.4);
  });
});

describe('speak / cancel', () => {
  beforeEach(() => {
    spoken.length = 0;
    cancelSpy.mockClear();
    fakeSynthesis.speaking = false;
    vi.stubGlobal('speechSynthesis', fakeSynthesis);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speaks the markdown-stripped text with the chosen voice and rate', () => {
    expect(speak('**Hello** [world](https://x.y)', { voiceURI: 'com.apple.voice.bob', rate: 1.5 })).toBe(true);

    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Hello world');
    expect(spoken[0].rate).toBe(1.5);
    expect(spoken[0].voice?.voiceURI).toBe('com.apple.voice.bob');
    expect(spoken[0].lang).toBe('de-DE');
  });

  it('cancels any previous utterance before starting a new one', () => {
    speak('first');
    speak('second');
    expect(cancelSpy).toHaveBeenCalledTimes(2);
    expect(spoken).toHaveLength(2);
  });

  it('reports nothing spoken when the text has no speakable content', () => {
    expect(speak('```\nonly code\n```')).toBe(false);
    expect(spoken).toHaveLength(0);
  });

  it('tracks and clears the speaking flag through cancel()', () => {
    speak('hello');
    expect(isSpeaking()).toBe(true);
    cancel();
    expect(cancelSpy).toHaveBeenCalled();
    expect(isSpeaking()).toBe(false);
  });

  it('exposes the system voices', () => {
    expect(listVoices().map((voice) => voice.voiceURI)).toEqual(['com.apple.voice.alice', 'com.apple.voice.bob']);
  });
});

describe('without speech synthesis support', () => {
  it('degrades to no-ops instead of throwing', () => {
    vi.unstubAllGlobals();
    expect(speak('hello')).toBe(false);
    expect(listVoices()).toEqual([]);
    expect(isSpeaking()).toBe(false);
    expect(() => cancel()).not.toThrow();
  });
});
