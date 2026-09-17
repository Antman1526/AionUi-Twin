/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SpeechToTextProvider = 'openai' | 'deepgram' | 'whisper-local';

export type OpenAISpeechToTextConfig = {
  apiKey: string;
  baseUrl?: string;
  language?: string;
  model: string;
  prompt?: string;
  temperature?: number;
};

export type DeepgramSpeechToTextConfig = {
  apiKey: string;
  baseUrl?: string;
  detectLanguage?: boolean;
  language?: string;
  model: string;
  punctuate?: boolean;
  smartFormat?: boolean;
};

/** Config for the offline `whisper-local` provider (whisper.cpp's `whisper-server`). */
export type WhisperLocalSpeechToTextConfig = {
  /** Absolute path to a downloaded ggml model file under `<userData>/whisper-models`. */
  modelPath?: string;
  /** Language hint forwarded to whisper-server (ISO 639-1, or 'auto' for auto-detect). */
  language?: string;
  /** User-picked override when whisper-server is not discoverable automatically. */
  executablePath?: string;
};

export type SpeechToTextConfig = {
  autoSend?: boolean;
  enabled: boolean;
  provider: SpeechToTextProvider;
  deepgram?: DeepgramSpeechToTextConfig;
  openai?: OpenAISpeechToTextConfig;
  whisperLocal?: WhisperLocalSpeechToTextConfig;
};

/** One entry in the curated whisper.cpp GGML model catalog offered for one-click download. */
export type WhisperModelCatalogEntry = {
  /** Stable identifier used by the download bridge. */
  id: string;
  /** File name written into `<userData>/whisper-models`. */
  file: string;
  /** Direct download URL (Hugging Face). */
  url: string;
  /** Lower-case hex SHA-256 the downloaded file must match. */
  sha256: string;
  /** Exact byte size of the published file. */
  bytes: number;
  /** Display label. */
  label: string;
};

/** A catalog entry plus whether it is already present on disk. */
export type WhisperModelInfo = WhisperModelCatalogEntry & {
  downloaded: boolean;
  /** Absolute path the model would be (or is) stored at. */
  path: string;
};

/** Whether the `whisper-server` executable could be located on this machine. */
export type WhisperExecutableStatus = {
  found: boolean;
  path?: string;
};

/** Runtime status of the single managed `whisper-server` process. */
export type WhisperRuntimeStatus = {
  running: boolean;
  modelPath?: string;
  port?: number;
  baseUrl?: string;
};

/** Progress of an in-flight (or finished) whisper model download. */
export type WhisperDownloadProgress = {
  id: string;
  receivedBytes: number;
  totalBytes?: number;
  state: 'downloading' | 'done' | 'error' | 'cancelled';
  error?: string;
};

/** Config for local, offline text-to-speech via the browser's `speechSynthesis` API. */
export type TextToSpeechConfig = {
  enabled: boolean;
  /** `SpeechSynthesisVoice.voiceURI` of the selected system voice. */
  voiceURI?: string;
  /** Playback rate forwarded to `SpeechSynthesisUtterance.rate` (0.1 - 10, default 1). */
  rate?: number;
  /** Automatically speak an assistant reply once its streaming completes. */
  autoReadReplies?: boolean;
};

export type SpeechToTextAudioBuffer = Uint8Array | number[] | Record<string, number>;

export type SpeechToTextRequest = {
  audioBuffer: SpeechToTextAudioBuffer;
  fileName: string;
  languageHint?: string;
  mimeType: string;
};

export type SpeechToTextResult = {
  language?: string;
  model: string;
  provider: SpeechToTextProvider;
  text: string;
};
