/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SpeechToTextProvider = 'openai' | 'deepgram' | 'whisper-local';

export type OpenAISpeechToTextConfig = {
  api_key: string;
  base_url?: string;
  language?: string;
  model: string;
  prompt?: string;
  temperature?: number;
};

export type DeepgramSpeechToTextConfig = {
  api_key: string;
  base_url?: string;
  detectLanguage?: boolean;
  language?: string;
  model: string;
  punctuate?: boolean;
  smartFormat?: boolean;
};

/**
 * Fully offline transcription served by a locally spawned `whisper-server`
 * (whisper.cpp). `modelPath` is the on-disk ggml model the process side is
 * asked to load; it is validated against the allowed model roots before any
 * process is spawned.
 */
export type WhisperLocalSpeechToTextConfig = {
  language?: string;
  modelPath?: string;
  translate?: boolean;
};

export type SpeechToTextConfig = {
  autoSend?: boolean;
  enabled: boolean;
  provider: SpeechToTextProvider;
  deepgram?: DeepgramSpeechToTextConfig;
  openai?: OpenAISpeechToTextConfig;
  whisperLocal?: WhisperLocalSpeechToTextConfig;
};

export type SpeechToTextAudioBuffer = Uint8Array | number[] | Record<string, number>;

export type SpeechToTextRequest = {
  audioBuffer: SpeechToTextAudioBuffer;
  file_name: string;
  languageHint?: string;
  mimeType: string;
};

export type SpeechToTextResult = {
  language?: string;
  model: string;
  provider: SpeechToTextProvider;
  text: string;
};

/**
 * Read-aloud settings. Speech synthesis runs entirely in the renderer through
 * the platform `speechSynthesis` API, so no network or API key is involved.
 */
export type TextToSpeechConfig = {
  /** Speak every assistant reply once its turn completes. */
  autoReadReplies?: boolean;
  enabled: boolean;
  /** Playback rate passed to `SpeechSynthesisUtterance.rate` (0.5 - 2). */
  rate?: number;
  /** `SpeechSynthesisVoice.voiceURI` of the chosen system voice. */
  voiceURI?: string;
};
