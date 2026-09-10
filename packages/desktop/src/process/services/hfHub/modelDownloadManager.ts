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
import { ProcessConfig } from '@process/utils/initStorage';

const HF_RESOLVE_URL = 'https://huggingface.co';

type ActiveDownload = {
  progress: HfDownloadProgress;
  abortController: AbortController;
  lastBytes: number;
  lastTime: number;
};

const activeDownloads = new Map<string, ActiveDownload>();

async function getTargetModelDirectory(): Promise<string> {
  const dirs = (await ProcessConfig.get('localModel.directories')) as string[] | undefined;
  if (Array.isArray(dirs) && dirs.length > 0 && dirs[0]) {
    return dirs[0];
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

  // If GGUF and no fileName provided, we resolve the first .gguf in repo
  const resolvedFileName = fileName || (isMlx ? 'model' : `${modelId.split('/').pop()}.gguf`);
  const targetDir = isMlx ? path.join(rootDir, 'mlx', modelId.replace('/', '--')) : rootDir;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const targetPath = isMlx ? path.join(targetDir, resolvedFileName) : path.join(targetDir, resolvedFileName);

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

  // Start asynchronous download loop
  void (async () => {
    try {
      const fileUrl = `${HF_RESOLVE_URL}/${modelId}/resolve/main/${encodeURIComponent(resolvedFileName)}?download=true`;
      const response = await fetch(fileUrl, {
        headers: { 'User-Agent': 'WE-App/2.2.2' },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Download request failed with status ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        progress.totalBytes = parseInt(contentLength, 10);
      }

      progress.status = 'downloading';
      ipcBridge.hfHub.downloadProgress.emit({ ...progress });

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const fileStream = fs.createWriteStream(targetPath);
      const reader = response.body.getReader();
      let downloaded = 0;
      let lastEmit = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          fileStream.write(Buffer.from(value));
          downloaded += value.byteLength;
          progress.downloadedBytes = downloaded;

          if (progress.totalBytes > 0) {
            progress.percent = Math.min(100, Math.round((downloaded / progress.totalBytes) * 100));
          }

          const now = Date.now();
          if (now - lastEmit >= 600) {
            const timeDiffSec = (now - active.lastTime) / 1000;
            if (timeDiffSec > 0) {
              progress.speedBytesPerSec = Math.round((downloaded - active.lastBytes) / timeDiffSec);
            }
            active.lastBytes = downloaded;
            active.lastTime = now;
            lastEmit = now;
            ipcBridge.hfHub.downloadProgress.emit({ ...progress });
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end(() => resolve());
        fileStream.on('error', reject);
      });

      progress.status = 'completed';
      progress.percent = 100;
      progress.speedBytesPerSec = 0;
      ipcBridge.hfHub.downloadProgress.emit({ ...progress });
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        progress.status = 'cancelled';
      } else {
        progress.status = 'failed';
        progress.error = err instanceof Error ? err.message : String(err);
      }
      ipcBridge.hfHub.downloadProgress.emit({ ...progress });

      // Clean up partial file on failure or cancel
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch {
          /* swallow */
        }
      }
    } finally {
      setTimeout(() => {
        activeDownloads.delete(downloadId);
      }, 10_000);
    }
  })();

  return { downloadId };
}
