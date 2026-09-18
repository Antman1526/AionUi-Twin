/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the offline whisper.cpp path of SpeechToTextService.
 * The request shape is fixed by whisper.cpp's `examples/server/README.md`:
 * multipart POST to /inference with the audio in the `file` field.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statusInvoke = vi.fn();
const getClientBusinessSetting = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    speechToText: { local: { status: { invoke: (...args: unknown[]) => statusInvoke(...args) } } },
  },
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  getBaseUrl: () => 'http://127.0.0.1:1234',
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: (...args: unknown[]) => getClientBusinessSetting(...args),
}));

// AudioContext/OfflineAudioContext do not exist under vitest's node env, so the
// decode step is stubbed — the WAV encoder itself has its own unit test.
vi.mock('@/renderer/services/audio/wavEncoder', () => ({
  convertBlobToWav: vi.fn(async (blob: Blob) => new Blob([await blob.arrayBuffer()], { type: 'audio/wav' })),
}));

const { transcribeAudioBlob, transcribeWithLocalWhisper } = await import('@/renderer/services/SpeechToTextService');

const fetchMock = vi.fn();

describe('local whisper transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ text: '  hello from whisper  ' }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs multipart form-data to <baseUrl>/inference with the documented field names', async () => {
    const result = await transcribeWithLocalWhisper(new Blob(['abc'], { type: 'audio/webm' }), {
      baseUrl: 'http://127.0.0.1:52001',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:52001/inference');
    expect(init.method).toBe('POST');

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(Blob);
    expect((body.get('file') as File).name).toBe('speech-input.wav');
    expect(body.get('response_format')).toBe('json');
    expect(body.get('temperature')).toBe('0.0');

    // whisper.cpp pads segments with a leading space; the send box must not get it.
    expect(result.text).toBe('hello from whisper');
    expect(result.provider).toBe('whisper-local');
  });

  it('strips a trailing slash from the base URL', async () => {
    await transcribeWithLocalWhisper(new Blob(['abc']), { baseUrl: 'http://127.0.0.1:52001/' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:52001/inference');
  });

  it('surfaces a non-2xx response as STT_REQUEST_FAILED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    await expect(transcribeWithLocalWhisper(new Blob(['abc']), { baseUrl: 'http://127.0.0.1:1' })).rejects.toThrow(
      /STT_REQUEST_FAILED:500/
    );
  });

  it('routes the whisper-local provider through the running local server', async () => {
    getClientBusinessSetting.mockResolvedValue({ enabled: true, provider: 'whisper-local', whisperLocal: {} });
    statusInvoke.mockResolvedValue({ success: true, data: { running: true, baseUrl: 'http://127.0.0.1:52002' } });

    await transcribeAudioBlob(new Blob(['abc'], { type: 'audio/webm' }));

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:52002/inference');
  });

  it('fails with a dedicated code when no local server is running', async () => {
    getClientBusinessSetting.mockResolvedValue({ enabled: true, provider: 'whisper-local' });
    statusInvoke.mockResolvedValue({ success: true, data: { running: false } });

    await expect(transcribeAudioBlob(new Blob(['abc']))).rejects.toThrow('STT_WHISPER_LOCAL_NOT_RUNNING');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
