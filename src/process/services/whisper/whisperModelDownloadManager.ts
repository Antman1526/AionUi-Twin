/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WhisperDownloadProgress } from '@/common/types/speech';
import { downloadVerified } from '@process/services/download/verifiedDownload';

export type WhisperDownloadRequest = {
  id: string;
  url: string;
  destPath: string;
  expectedSha256: string;
  expectedBytes: number;
};

export type WhisperModelDownloadManager = {
  /** Download one model, emitting progress. Resolves with the final path. */
  start: (request: WhisperDownloadRequest) => Promise<string>;
  /** Id of the download currently in flight, or null. */
  activeId: () => string | null;
};

/**
 * Serialised single-slot download for whisper models, with progress pushed
 * through `onProgress`.
 *
 * `download` is injected so tests can drive it against a stub instead of
 * hitting the network; it defaults to {@link downloadVerified}, which rejects
 * any file whose SHA-256 or size does not match the catalog entry.
 */
export function createWhisperModelDownloadManager({
  onProgress,
  download = downloadVerified,
}: {
  onProgress: (progress: WhisperDownloadProgress) => void;
  download?: typeof downloadVerified;
}): WhisperModelDownloadManager {
  let activeId: string | null = null;

  return {
    activeId: () => activeId,
    start: async (request) => {
      if (activeId) {
        throw new Error('Another whisper model download is already in progress');
      }
      activeId = request.id;
      onProgress({ id: request.id, receivedBytes: 0, totalBytes: request.expectedBytes, state: 'downloading' });
      try {
        await download({
          url: request.url,
          destPath: request.destPath,
          expectedSha256: request.expectedSha256,
          expectedBytes: request.expectedBytes,
          onProgress: ({ receivedBytes, totalBytes }) =>
            onProgress({
              id: request.id,
              receivedBytes,
              totalBytes: totalBytes ?? request.expectedBytes,
              state: 'downloading',
            }),
        });
        onProgress({
          id: request.id,
          receivedBytes: request.expectedBytes,
          totalBytes: request.expectedBytes,
          state: 'done',
        });
        return request.destPath;
      } catch (error) {
        onProgress({
          id: request.id,
          receivedBytes: 0,
          totalBytes: request.expectedBytes,
          state: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        activeId = null;
      }
    },
  };
}
