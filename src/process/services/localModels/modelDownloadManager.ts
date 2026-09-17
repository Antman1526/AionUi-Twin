/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { downloadVerified } from '@process/services/download/verifiedDownload';

/** Terminal and in-flight states reported while a catalog model downloads. */
export type CatalogDownloadState = 'downloading' | 'done' | 'error' | 'cancelled';

export type CatalogDownloadProgress = {
  id: string;
  receivedBytes: number;
  totalBytes?: number;
  state: CatalogDownloadState;
  error?: string;
};

export type CatalogDownloadRequest = {
  id: string;
  url: string;
  destPath: string;
  expectedSha256: string;
  expectedBytes: number;
};

export type ModelDownloadManager = {
  /** Download one model, emitting progress. Resolves with the final path. */
  start: (request: CatalogDownloadRequest) => Promise<string>;
  /** Abort the download with this id. Returns false when nothing matched. */
  cancel: (id: string) => boolean;
  /** Id of the download currently in flight, or null. */
  activeId: () => string | null;
};

/**
 * Serialised download queue for catalog models — one at a time, cancellable, with
 * progress pushed through `onProgress`.
 *
 * `download` is injected so tests can drive it against a loopback server; it
 * defaults to {@link downloadVerified}, which rejects any file whose SHA-256 or
 * size does not match the catalog entry.
 */
export function createModelDownloadManager({
  onProgress,
  download = downloadVerified,
}: {
  onProgress: (progress: CatalogDownloadProgress) => void;
  download?: typeof downloadVerified;
}): ModelDownloadManager {
  const controllers = new Map<string, AbortController>();

  return {
    activeId: () => controllers.keys().next().value ?? null,
    cancel: (id) => {
      const controller = controllers.get(id);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    start: async (request) => {
      if (controllers.size > 0) {
        throw new Error('Another model download is already in progress');
      }
      const controller = new AbortController();
      controllers.set(request.id, controller);
      onProgress({ id: request.id, receivedBytes: 0, totalBytes: request.expectedBytes, state: 'downloading' });
      try {
        await download({
          url: request.url,
          destPath: request.destPath,
          expectedSha256: request.expectedSha256,
          expectedBytes: request.expectedBytes,
          signal: controller.signal,
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
        const cancelled = controller.signal.aborted;
        onProgress({
          id: request.id,
          receivedBytes: 0,
          totalBytes: request.expectedBytes,
          state: cancelled ? 'cancelled' : 'error',
          error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        controllers.delete(request.id);
      }
    },
  };
}
