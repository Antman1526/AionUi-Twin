/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import type { SpeechToTextResult } from '@/common/types/provider/speech';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { convertBlobToWav } from '@/renderer/services/audio/wavEncoder';

/** Dispatched on window whenever the speech-to-text config is saved. */
export const SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT = 'aionui:speech-to-text-config-changed';

const MAX_AUDIO_FILE_SIZE_MB = 30;
const MAX_AUDIO_FILE_SIZE_BYTES = MAX_AUDIO_FILE_SIZE_MB * 1024 * 1024;

const getAudioExtension = (mimeType: string) => {
  switch (mimeType) {
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
    case 'audio/ogg;codecs=opus':
      return 'ogg';
    case 'audio/wav':
    case 'audio/wave':
      return 'wav';
    default:
      return 'webm';
  }
};

const createAudioFileName = (mimeType: string) => {
  return `speech-input.${getAudioExtension(mimeType)}`;
};

const ensureAudioSize = (blob: Blob) => {
  if (blob.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new Error('STT_FILE_TOO_LARGE');
  }
};

const parseSuccessResponse = (response: XMLHttpRequest): SpeechToTextResult => {
  const payload = JSON.parse(response.responseText) as {
    data?: SpeechToTextResult;
    msg?: string;
    success: boolean;
  };

  if (!payload.success || !payload.data) {
    throw new Error(payload.msg || 'STT_REQUEST_FAILED');
  }

  return payload.data;
};

// Surface the backend error code (STT_DISABLED, STT_OPENAI_NOT_CONFIGURED, ...)
// so useSpeechInput can map it to a localized error state.
const parseErrorResponse = (response: XMLHttpRequest): Error => {
  if (response.status === 413) {
    return new Error('STT_FILE_TOO_LARGE');
  }

  try {
    const payload = JSON.parse(response.responseText) as { code?: string; error?: string; msg?: string };
    const code = payload.code;
    const detail = payload.error || payload.msg;
    if (code || detail) {
      return new Error([code, detail].filter(Boolean).join(': '));
    }
  } catch {
    // Non-JSON error body — fall back to the status line below.
  }

  return new Error(`STT_REQUEST_FAILED:${response.status} ${response.statusText}`);
};

/** Multipart field the whisper.cpp server reads the audio from (`/inference`). */
export const WHISPER_LOCAL_INFERENCE_PATH = '/inference';

/**
 * Transcribe through a locally running `whisper-server`.
 *
 * The contract comes from whisper.cpp's `examples/server/README.md`: a
 * multipart POST to `/inference` with the audio in the `file` field plus
 * `temperature` / `response_format`, answering `{ "text": "..." }` for
 * `response_format=json`. The server only accepts WAV, so the MediaRecorder
 * blob is re-encoded to 16 kHz mono first.
 */
export async function transcribeWithLocalWhisper(
  blob: Blob,
  { baseUrl, language }: { baseUrl: string; language?: string }
): Promise<SpeechToTextResult> {
  const wav = await convertBlobToWav(blob);

  const formData = new FormData();
  formData.append('file', wav, 'speech-input.wav');
  formData.append('temperature', '0.0');
  formData.append('response_format', 'json');

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${WHISPER_LOCAL_INFERENCE_PATH}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`STT_REQUEST_FAILED:${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { text?: string };
  return {
    // whisper.cpp prefixes segments with a space; the send box should not.
    text: (payload.text ?? '').trim(),
    model: 'whisper-local',
    provider: 'whisper-local',
    language,
  };
}

export async function transcribeAudioBlob(blob: Blob, languageHint?: string): Promise<SpeechToTextResult> {
  ensureAudioSize(blob);

  // The local provider never reaches the backend: it talks straight to the
  // whisper-server this app spawned, so it stays usable with no network.
  const config = await getClientBusinessSetting('tools.speechToText').catch((): undefined => undefined);
  if (config?.provider === 'whisper-local') {
    const status = await ipcBridge.speechToText.local.status.invoke();
    if (!status.success || !status.data?.running || !status.data.baseUrl) {
      throw new Error('STT_WHISPER_LOCAL_NOT_RUNNING');
    }
    return transcribeWithLocalWhisper(blob, {
      baseUrl: status.data.baseUrl,
      language: languageHint || config.whisperLocal?.language,
    });
  }

  const mimeType = blob.type || 'audio/webm';
  const file_name = createAudioFileName(mimeType);

  // Backend /api/stt only accepts multipart with these exact field names.
  const formData = new FormData();
  formData.append('file', blob, file_name);
  formData.append('fileName', file_name);
  formData.append('mimeType', mimeType);
  if (languageHint) {
    formData.append('languageHint', languageHint);
  }

  return new Promise<SpeechToTextResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getBaseUrl()}/api/stt`);
    // No withCredentials: the desktop backend allows origin `*`, which the
    // browser rejects for credentialed requests; WebUI is same-origin anyway.

    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(parseErrorResponse(xhr));
        return;
      }

      try {
        resolve(parseSuccessResponse(xhr));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('STT_NETWORK_ERROR'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('STT_ABORTED'));
    });

    xhr.send(formData);
  });
}
