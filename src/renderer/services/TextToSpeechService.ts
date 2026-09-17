/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local, offline text-to-speech via the browser's `speechSynthesis` API.
 *
 * No network call and no API key: voices come from the OS/browser. Used both
 * for the per-message "Read aloud" speaker button and for auto-reading
 * assistant replies when `tools.textToSpeech.autoReadReplies` is enabled.
 */

/** Dispatched on `window` whenever `tools.textToSpeech` is saved, so open UI can resync. */
export const TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT = 'aionui:text-to-speech-config-changed';

export type SpeakOptions = {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
};

/**
 * Strip the markdown syntax that would otherwise be read aloud literally
 * (fence markers, link URLs, emphasis markers) while keeping the readable text.
 */
export function stripMarkdownForSpeech(markdown: string): string {
  let text = markdown;

  // Fenced code blocks: drop entirely (reading code aloud is not useful).
  text = text.replace(/```[\s\S]*?```/g, ' ');
  // Inline code: keep the content, drop the backticks.
  text = text.replace(/`([^`]+)`/g, '$1');
  // Images: drop entirely (alt text rarely reads well on its own).
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
  // Links: keep the label, drop the URL.
  text = text.replace(/\[([^\]]+)]\([^)]*\)/g, '$1');
  // Emphasis / bold / strikethrough markers.
  text = text.replace(/(\*\*\*|___)(.*?)\1/g, '$2');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  // Headings / blockquote / list markers at line start.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s*([-*+]|\d+\.)\s+/gm, '');
  // Horizontal rules.
  text = text.replace(/^\s*([-*_]\s*){3,}$/gm, ' ');

  return text.replace(/\n{2,}/g, '\n').trim();
}

const getSynthesis = (): SpeechSynthesis | undefined => {
  return typeof window !== 'undefined' ? window.speechSynthesis : undefined;
};

/** Whether the platform exposes the Web Speech synthesis API at all. */
export const isTextToSpeechSupported = (): boolean => Boolean(getSynthesis());

/** All system voices currently available to `speechSynthesis`. */
export const listVoices = (): SpeechSynthesisVoice[] => {
  return getSynthesis()?.getVoices() ?? [];
};

/** Whether an utterance is currently being spoken (or pending). */
export const isSpeaking = (): boolean => {
  const synth = getSynthesis();
  return Boolean(synth?.speaking || synth?.pending);
};

/** Stop any in-progress or queued speech. */
export const cancel = (): void => {
  getSynthesis()?.cancel();
};

/**
 * Speak `text` (markdown is stripped first). Cancels any speech already in
 * progress, so only one utterance plays at a time. Resolves when speaking
 * finishes (`onend`) or rejects on `onerror` (except a deliberate `cancel()`,
 * which resolves quietly).
 */
export const speak = (text: string, options: SpeakOptions = {}): Promise<void> => {
  const synth = getSynthesis();
  if (!synth) {
    return Promise.reject(new Error('TTS_UNSUPPORTED'));
  }

  const plainText = stripMarkdownForSpeech(text);
  if (!plainText) {
    return Promise.resolve();
  }

  synth.cancel();

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(plainText);
    if (options.rate) utterance.rate = options.rate;
    if (options.pitch) utterance.pitch = options.pitch;
    if (options.voiceURI) {
      const voice = synth.getVoices().find((candidate) => candidate.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') {
        resolve();
        return;
      }
      reject(new Error(`TTS_SPEAK_FAILED:${event.error}`));
    };

    synth.speak(utterance);
  });
};

export const TextToSpeechService = {
  isSupported: isTextToSpeechSupported,
  listVoices,
  isSpeaking,
  cancel,
  speak,
};

export default TextToSpeechService;
