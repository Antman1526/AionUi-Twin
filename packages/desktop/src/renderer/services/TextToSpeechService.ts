/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextToSpeechConfig } from '@/common/types/provider/speech';

/**
 * Read-aloud through the platform `speechSynthesis` API.
 *
 * Everything here runs offline against the voices installed on the machine —
 * no API key, no request, nothing to configure beyond picking a voice.
 */

/** Dispatched on window whenever the read-aloud config is saved. */
export const TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT = 'aionui:text-to-speech-config-changed';

export const DEFAULT_TEXT_TO_SPEECH_CONFIG: TextToSpeechConfig = {
  autoReadReplies: false,
  enabled: false,
  rate: 1,
  voiceURI: '',
};

export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2;

export const normalizeTextToSpeechConfig = (config?: Partial<TextToSpeechConfig>): TextToSpeechConfig => ({
  ...DEFAULT_TEXT_TO_SPEECH_CONFIG,
  ...config,
  rate: clampRate(config?.rate),
});

export function clampRate(rate?: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
  return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
}

// ---------------------------------------------------------------------------
// Markdown stripping
// ---------------------------------------------------------------------------

/**
 * Turn a Markdown reply into something worth listening to: code blocks are
 * dropped entirely, link syntax collapses to its label, and emphasis markers
 * disappear.
 *
 * Underscore emphasis is only stripped at word boundaries, so identifiers like
 * `snake_case_name` are read out intact instead of losing their underscores.
 */
export function stripMarkdownForSpeech(text: string): string {
  if (!text) return '';

  let output = text;

  // Fenced code blocks (``` or ~~~) carry no spoken value at all.
  output = output.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, '');
  // An unterminated fence at the end of a streamed reply.
  output = output.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*$/m, '');
  // Inline code keeps its content, loses the backticks.
  output = output.replace(/`([^`\n]+)`/g, '$1');

  // Images first (they are links with a leading `!`), then links: keep the label.
  output = output.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  output = output.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Reference-style links and bare autolinks.
  output = output.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  output = output.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // Block syntax: headings, blockquotes, list bullets, horizontal rules.
  output = output.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  output = output.replace(/^[ \t]*>[ \t]?/gm, '');
  output = output.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '');
  output = output.replace(/^[ \t]*(?:[-*_])[ \t]*(?:[-*_][ \t]*){2,}$/gm, '');

  // Emphasis. Asterisks are unambiguous; underscores must sit on word
  // boundaries so `snake_case` survives.
  output = output.replace(/~~([^~\n]+)~~/g, '$1');
  output = output.replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1');
  output = output.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  output = output.replace(/\*([^*\n]+)\*/g, '$1');
  output = output.replace(/(?<![\w\\])__([^_\n]+)__(?!\w)/g, '$1');
  output = output.replace(/(?<![\w\\])_([^_\n]+)_(?!\w)/g, '$1');

  // Table pipes read as noise.
  output = output.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '');
  output = output.replace(/[ \t]*\|[ \t]*/g, ' ');

  // Collapse the blank lines left behind by the removals.
  output = output.replace(/\n{3,}/g, '\n\n');
  return output.trim();
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

export type SpeakOptions = {
  onEnd?: () => void;
  onError?: () => void;
  rate?: number;
  voiceURI?: string;
};

type SpeechSynthesisLike = {
  cancel: () => void;
  getVoices: () => SpeechSynthesisVoice[];
  speak: (utterance: SpeechSynthesisUtterance) => void;
  speaking: boolean;
};

function getSynthesis(): SpeechSynthesisLike | null {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesisLike }).speechSynthesis;
  return synth ?? null;
}

function getUtteranceCtor(): typeof SpeechSynthesisUtterance | null {
  return (
    (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance ?? null
  );
}

/** Whether this runtime can speak at all (false in tests/SSR without a shim). */
export function isSpeechSynthesisSupported(): boolean {
  return Boolean(getSynthesis() && getUtteranceCtor());
}

/** System voices, or an empty list when synthesis is unavailable. */
export function listVoices(): SpeechSynthesisVoice[] {
  try {
    return getSynthesis()?.getVoices() ?? [];
  } catch {
    return [];
  }
}

export function isSpeaking(): boolean {
  return Boolean(getSynthesis()?.speaking);
}

export function cancel(): void {
  try {
    getSynthesis()?.cancel();
  } catch {
    /* nothing was speaking */
  }
}

/**
 * Speak `text` after stripping its Markdown. Returns false when there is
 * nothing speakable or the platform has no synthesis support, so callers can
 * roll back any optimistic "speaking" UI state.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const synth = getSynthesis();
  const Utterance = getUtteranceCtor();
  if (!synth || !Utterance) return false;

  const spoken = stripMarkdownForSpeech(text);
  if (!spoken) return false;

  // One utterance at a time: a second speak() replaces the first.
  cancel();

  const utterance = new Utterance(spoken);
  utterance.rate = clampRate(options.rate);
  if (options.voiceURI) {
    const voice = listVoices().find((candidate) => candidate.voiceURI === options.voiceURI);
    if (voice) {
      utterance.voice = voice;
      // Some engines ignore `voice` unless the language matches it.
      utterance.lang = voice.lang;
    }
  }
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onError?.();

  synth.speak(utterance);
  return true;
}
