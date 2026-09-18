/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import type { HfDownloadProgress } from '@/common/adapter/ipcBridge';
import { uuid } from '@/common/utils';
import { getDefaultLocalModelDirectories } from '@process/services/localModels/defaultModelDirectories';
import { createSizeGuard, resolveMaxBytes, verifyDigest } from './downloadIntegrity';
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

function removePartialFile(partPath: string): void {
  if (fs.existsSync(partPath)) {
    try {
      fs.unlinkSync(partPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stream a single file from Hugging Face with progress callbacks, verifying
 * its integrity as it goes:
 *  - a byte cap (derived from `content-length` when present, else a generous
 *    finite default) is enforced on every chunk, so a misbehaving/hostile
 *    endpoint is cut off mid-stream instead of writing an unbounded file;
 *  - a running sha256 digest is checked against `expectedSha256` (when
 *    known) once the stream ends.
 * The file is written to `<destinationPath>.part` and only renamed into
 * place once both checks pass; on any failure the partial file is removed so
 * a truncated/tampered download can never be discovered and loaded.
 */
export async function streamFileFromHf({
  modelId,
  fileName,
  destinationPath,
  signal,
  onChunk,
  expectedSha256,
  maxBytesOverride,
  baseUrl = HF_RESOLVE_URL,
}: {
  modelId: string;
  fileName: string;
  destinationPath: string;
  signal: AbortSignal;
  onChunk: (bytesRead: number, totalExpectedBytes?: number) => void;
  expectedSha256?: string;
  maxBytesOverride?: number;
  baseUrl?: string;
}): Promise<{ verified: boolean }> {
  const fileUrl = `${baseUrl}/${modelId}/resolve/main/${encodeURIComponent(fileName)}?download=true`;
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

  const partPath = `${destinationPath}.part`;
  const sizeGuard = createSizeGuard(resolveMaxBytes(expectedBytes, maxBytesOverride));
  const hash = crypto.createHash('sha256');
  const fileStream = fs.createWriteStream(partPath);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // Enforce the cap before doing anything else with the chunk so a
        // hostile/broken stream is cut off immediately, not after it has
        // already been buffered to disk.
        sizeGuard.accept(value.byteLength);
        hash.update(value);
        fileStream.write(Buffer.from(value));
        onChunk(value.byteLength, expectedBytes);
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on('error', reject);
    });

    const actualHex = hash.digest('hex');
    verifyDigest(actualHex, expectedSha256);

    fs.renameSync(partPath, destinationPath);
    return { verified: expectedSha256 !== undefined };
  } catch (err) {
    fileStream.destroy();
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    removePartialFile(partPath);
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

        let allVerified = true;
        for (const file of filesToDownload) {
          if (abortController.signal.aborted) break;
          const filePath = path.join(targetDir, file.name);

          const result = await streamFileFromHf({
            modelId,
            fileName: file.name,
            destinationPath: filePath,
            signal: abortController.signal,
            expectedSha256: file.sha256,
            onChunk: (bytesRead) => {
              progress.downloadedBytes += bytesRead;
              if (progress.totalBytes > 0) {
                progress.percent = Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
              }
              updateSpeed();
            },
          });
          if (!result.verified) allVerified = false;
        }
        progress.verified = allVerified;
      } else {
        // Single file download (e.g. GGUF or specific file) — look up the
        // expected LFS sha256 (when the repository exposes one) so the
        // stream can be verified as it downloads.
        let expectedSha256: string | undefined;
        try {
          const details = await getHfModelDetails(modelId);
          const match = details.files.find((f) => f.name === resolvedFileName || f.path === resolvedFileName);
          expectedSha256 = match?.sha256;
        } catch {
          // Metadata lookup failing is not fatal — proceed unverified.
        }

        const result = await streamFileFromHf({
          modelId,
          fileName: resolvedFileName,
          destinationPath: targetPath,
          signal: abortController.signal,
          expectedSha256,
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
        progress.verified = result.verified;
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
