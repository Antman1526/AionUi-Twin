/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import type { HfDownloadProgress } from '@/common/adapter/ipcBridge';
import { uuid } from '@/common/utils';
import { getDefaultLocalModelDirectories } from '@process/services/localModels/defaultModelDirectories';
import { getHfModelDetails } from './hfModelHubService';

const HF_RESOLVE_URL = 'https://huggingface.co';

type ActiveDownload = {
  progress: HfDownloadProgress;
  abortController: AbortController;
  lastBytes: number;
  lastTime: number;
};

const activeDownloads = new Map<string, ActiveDownload>();

async function getTargetModelDirectory(): Promise<string> {
  try {
    const { ProcessConfig } = await import('@process/utils/initStorage');
    const dirs = (await ProcessConfig.get('localModel.directories')) as string[] | undefined;
    if (Array.isArray(dirs) && dirs.length > 0 && dirs[0]) {
      return dirs[0];
    }
  } catch {
    /* Fallback if ProcessConfig is not initialized */
  }

  const defaults = getDefaultLocalModelDirectories();
  const target = defaults[0] || path.join(process.env.HOME || '.', '.cache', 'we', 'models');
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

export function getActiveDownloads(): HfDownloadProgress[] {
  return Array.from(activeDownloads.values()).map((d) => ({ ...d.progress }));
}

export function cancelModelDownload(downloadId: string): boolean {
  const active = activeDownloads.get(downloadId);
  if (!active) return false;

  active.abortController.abort();
  active.progress.status = 'cancelled';
  ipcBridge.hfHub.downloadProgress.emit({ ...active.progress });
  activeDownloads.delete(downloadId);
  return true;
}

/** Helper to stream a single file from Hugging Face with progress callbacks */
async function streamFileFromHf({
  modelId,
  fileName,
  destinationPath,
  signal,
  onChunk,
}: {
  modelId: string;
  fileName: string;
  destinationPath: string;
  signal: AbortSignal;
  onChunk: (bytesRead: number, totalExpectedBytes?: number) => void;
}): Promise<void> {
  const fileUrl = `${HF_RESOLVE_URL}/${modelId}/resolve/main/${encodeURIComponent(fileName)}?download=true`;
  const response = await fetch(fileUrl, {
    headers: { 'User-Agent': 'WE-App/2.2.2' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Download request failed for ${fileName} (${response.status} ${response.statusText})`);
  }

  const contentLength = response.headers.get('content-length');
  const expectedBytes = contentLength ? parseInt(contentLength, 10) : undefined;

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const fileStream = fs.createWriteStream(destinationPath);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        fileStream.write(Buffer.from(value));
        onChunk(value.byteLength, expectedBytes);
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on('error', reject);
    });
  } catch (err) {
    fileStream.destroy();
    if (fs.existsSync(destinationPath)) {
      try {
        fs.unlinkSync(destinationPath);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

export async function startModelDownload({
  modelId,
  fileName,
  isMlx = false,
}: {
  modelId: string;
  fileName?: string;
  isMlx?: boolean;
}): Promise<{ downloadId: string }> {
  const downloadId = uuid();
  const abortController = new AbortController();
  const rootDir = await getTargetModelDirectory();

  const isBundle = isMlx && !fileName;
  const resolvedFileName = fileName || (isMlx ? `${modelId.split('/').pop()}-mlx` : `${modelId.split('/').pop()}.gguf`);

  let targetDir = rootDir;
  if (isMlx) {
    if (fs.existsSync(path.join(rootDir, 'MLX'))) {
      targetDir = path.join(rootDir, 'MLX', modelId.replace('/', '--'));
    } else if (fs.existsSync(path.join(rootDir, 'mlx'))) {
      targetDir = path.join(rootDir, 'mlx', modelId.replace('/', '--'));
    } else {
      targetDir = path.join(rootDir, modelId.replace('/', '--'));
    }
  } else {
    if (fs.existsSync(path.join(rootDir, 'GGUF'))) {
      targetDir = path.join(rootDir, 'GGUF');
    } else if (fs.existsSync(path.join(rootDir, 'gguf'))) {
      targetDir = path.join(rootDir, 'gguf');
    } else {
      targetDir = rootDir;
    }
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const targetPath = isBundle ? targetDir : path.join(targetDir, resolvedFileName);

  const progress: HfDownloadProgress = {
    downloadId,
    modelId,
    fileName: resolvedFileName,
    isMlx,
    totalBytes: 0,
    downloadedBytes: 0,
    speedBytesPerSec: 0,
    percent: 0,
    status: 'pending',
    targetPath,
  };

  const active: ActiveDownload = {
    progress,
    abortController,
    lastBytes: 0,
    lastTime: Date.now(),
  };

  activeDownloads.set(downloadId, active);
  ipcBridge.hfHub.downloadProgress.emit({ ...progress });

  // Start background download routine
  void (async () => {
    try {
      progress.status = 'downloading';
      ipcBridge.hfHub.downloadProgress.emit({ ...progress });

      let lastEmit = Date.now();
      const updateSpeed = () => {
        const now = Date.now();
        if (now - lastEmit >= 600) {
          const timeDiffSec = (now - active.lastTime) / 1000;
          if (timeDiffSec > 0) {
            progress.speedBytesPerSec = Math.round((progress.downloadedBytes - active.lastBytes) / timeDiffSec);
          }
          active.lastBytes = progress.downloadedBytes;
          active.lastTime = now;
          lastEmit = now;
          ipcBridge.hfHub.downloadProgress.emit({ ...progress });
        }
      };

      if (isBundle) {
        // Download all files in MLX repository
        const details = await getHfModelDetails(modelId);
        const filesToDownload =
          details.files.length > 0 ? details.files : [{ name: 'config.json', path: 'config.json', sizeBytes: 0 }];
        progress.totalBytes = filesToDownload.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

        for (const file of filesToDownload) {
          if (abortController.signal.aborted) break;
          const filePath = path.join(targetDir, file.name);

          await streamFileFromHf({
            modelId,
            fileName: file.name,
            destinationPath: filePath,
            signal: abortController.signal,
            onChunk: (bytesRead) => {
              progress.downloadedBytes += bytesRead;
              if (progress.totalBytes > 0) {
                progress.percent = Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
              }
              updateSpeed();
            },
          });
        }
      } else {
        // Single file download (e.g. GGUF or specific file)
        await streamFileFromHf({
          modelId,
          fileName: resolvedFileName,
          destinationPath: targetPath,
          signal: abortController.signal,
          onChunk: (bytesRead, expectedBytes) => {
            if (expectedBytes && progress.totalBytes === 0) {
              progress.totalBytes = expectedBytes;
            }
            progress.downloadedBytes += bytesRead;
            if (progress.totalBytes > 0) {
              progress.percent = Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
            }
            updateSpeed();
          },
        });
      }

      if (!abortController.signal.aborted) {
        progress.status = 'completed';
        progress.percent = 100;
        progress.speedBytesPerSec = 0;
        ipcBridge.hfHub.downloadProgress.emit({ ...progress });
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        progress.status = 'cancelled';
      } else {
        progress.status = 'failed';
        progress.error = err instanceof Error ? err.message : String(err);
      }
      ipcBridge.hfHub.downloadProgress.emit({ ...progress });
    } finally {
      setTimeout(() => {
        activeDownloads.delete(downloadId);
      }, 10_000);
    }
  })();

  return { downloadId };
}
