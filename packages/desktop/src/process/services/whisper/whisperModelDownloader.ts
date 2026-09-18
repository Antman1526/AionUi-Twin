/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildWhisperModelUrl, type WhisperCatalogEntry } from './whisperCatalog';

export type WhisperDownloadProgress = {
  id: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  status: 'downloading' | 'completed' | 'failed';
  error?: string;
  targetPath?: string;
};

/**
 * Stream one catalog entry into `targetDirectory`.
 *
 * The bytes go to a sibling `.part` file and are hashed as they arrive; the
 * final rename only happens once both the byte count and the sha256 match the
 * catalog. A partial or tampered download therefore never appears as a usable
 * model file.
 */
export async function downloadWhisperModel({
  entry,
  targetDirectory,
  signal,
  onProgress,
  fetchImpl = fetch,
}: {
  entry: WhisperCatalogEntry;
  targetDirectory: string;
  signal?: AbortSignal;
  onProgress?: (progress: WhisperDownloadProgress) => void;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  fs.mkdirSync(targetDirectory, { recursive: true });

  const targetPath = path.join(targetDirectory, entry.fileName);
  const partPath = `${targetPath}.part`;

  const emit = (progress: Omit<WhisperDownloadProgress, 'id' | 'fileName'>): void => {
    onProgress?.({ id: entry.id, fileName: entry.fileName, ...progress });
  };

  const response = await fetchImpl(buildWhisperModelUrl(entry), { signal });
  if (!response.ok || !response.body) {
    const message = `Download failed for ${entry.fileName} (${response.status} ${response.statusText})`;
    emit({ downloadedBytes: 0, totalBytes: entry.sizeBytes, percent: 0, status: 'failed', error: message });
    throw new Error(message);
  }

  const hash = createHash('sha256');
  const stream = fs.createWriteStream(partPath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;

  const cleanup = (): void => {
    stream.destroy();
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    } catch {
      /* best effort — a leftover .part is never loaded */
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      downloadedBytes += chunk.byteLength;
      if (downloadedBytes > entry.sizeBytes) {
        throw new Error(`${entry.fileName} is larger than the expected ${entry.sizeBytes} bytes`);
      }
      stream.write(chunk);
      emit({
        downloadedBytes,
        totalBytes: entry.sizeBytes,
        percent: Math.min(100, Math.round((downloadedBytes / entry.sizeBytes) * 100)),
        status: 'downloading',
      });
    }

    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject);
      stream.end(() => resolve());
    });

    if (downloadedBytes !== entry.sizeBytes) {
      throw new Error(`${entry.fileName} size mismatch: expected ${entry.sizeBytes}, got ${downloadedBytes}`);
    }
    const digest = hash.digest('hex');
    if (digest !== entry.sha256) {
      throw new Error(`${entry.fileName} checksum mismatch: expected ${entry.sha256}, got ${digest}`);
    }

    fs.renameSync(partPath, targetPath);
    emit({
      downloadedBytes,
      totalBytes: entry.sizeBytes,
      percent: 100,
      status: 'completed',
      targetPath,
    });
    return targetPath;
  } catch (error) {
    cleanup();
    const message = error instanceof Error ? error.message : String(error);
    emit({
      downloadedBytes,
      totalBytes: entry.sizeBytes,
      percent: 0,
      status: 'failed',
      error: message,
    });
    throw error instanceof Error ? error : new Error(message);
  }
}
