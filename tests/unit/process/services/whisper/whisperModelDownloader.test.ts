/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the whisper model downloader's integrity guard: a model file
 * only appears on disk when both its size and its sha256 match the catalog.
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadWhisperModel } from '@process/services/whisper/whisperModelDownloader';
import type { WhisperCatalogEntry } from '@process/services/whisper/whisperCatalog';

const payload = Buffer.from('pretend ggml weights');
const entry: WhisperCatalogEntry = {
  id: 'test-model',
  fileName: 'ggml-test.bin',
  label: 'Test',
  sizeBytes: payload.byteLength,
  sha256: createHash('sha256').update(payload).digest('hex'),
};

const okResponse = (body: Buffer) =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new Uint8Array(body) };
          },
        };
      },
    },
  }) as unknown as Response;

let targetDirectory: string;

describe('downloadWhisperModel', () => {
  beforeEach(() => {
    targetDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-dl-'));
  });

  afterEach(() => {
    fs.rmSync(targetDirectory, { recursive: true, force: true });
  });

  it('writes the verified file and reports completion', async () => {
    const onProgress = vi.fn();
    const result = await downloadWhisperModel({
      entry,
      targetDirectory,
      onProgress,
      fetchImpl: async () => okResponse(payload),
    });

    expect(result).toBe(path.join(targetDirectory, 'ggml-test.bin'));
    expect(fs.readFileSync(result)).toEqual(payload);
    expect(fs.existsSync(`${result}.part`)).toBe(false);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'completed', percent: 100 });
  });

  it('rejects a checksum mismatch and leaves nothing behind', async () => {
    const tampered = Buffer.from('tampered ggml weight');
    expect(tampered.byteLength).toBe(entry.sizeBytes);

    await expect(
      downloadWhisperModel({ entry, targetDirectory, fetchImpl: async () => okResponse(tampered) })
    ).rejects.toThrow(/checksum mismatch/);

    expect(fs.readdirSync(targetDirectory)).toEqual([]);
  });

  it('rejects a truncated download instead of renaming the .part file', async () => {
    await expect(
      downloadWhisperModel({ entry, targetDirectory, fetchImpl: async () => okResponse(payload.subarray(0, 4)) })
    ).rejects.toThrow(/size mismatch/);

    expect(fs.readdirSync(targetDirectory)).toEqual([]);
  });

  it('reports a failed HTTP response', async () => {
    const onProgress = vi.fn();
    await expect(
      downloadWhisperModel({
        entry,
        targetDirectory,
        onProgress,
        fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found' }) as Response,
      })
    ).rejects.toThrow(/404/);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' });
  });
});
