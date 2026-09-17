/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { WhisperExecutableStatus, WhisperModelInfo, WhisperRuntimeStatus } from '@/common/types/speech';
import { ProcessConfig } from '@process/utils/initStorage';
import { mainError } from '@process/utils/mainLogger';
import {
  findWhisperServerExecutable,
  getManagedWhisperServerStatus,
  getWhisperModelsDirectory,
  startManagedWhisperServer,
  stopManagedWhisperServer,
  type WhisperServerHandle,
} from '@process/services/whisper/WhisperRuntimeService';
import { WHISPER_MODEL_CATALOG, findWhisperCatalogModel } from '@process/services/whisper/whisperModelCatalog';
import { createWhisperModelDownloadManager } from '@process/services/whisper/whisperModelDownloadManager';
import { SpeechToTextService } from './services/SpeechToTextService';

function toRuntimeStatus(handle: WhisperServerHandle | null): WhisperRuntimeStatus {
  if (!handle) return { running: false };
  return { running: true, modelPath: handle.modelPath, port: handle.port, baseUrl: handle.baseUrl };
}

function getModelsDirectory(): string {
  return getWhisperModelsDirectory(app.getPath('userData'));
}

function toModelInfo(entry: (typeof WHISPER_MODEL_CATALOG)[number]): WhisperModelInfo {
  const modelPath = path.join(getModelsDirectory(), entry.file);
  return { ...entry, downloaded: existsSync(modelPath), path: modelPath };
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function initSpeechToTextBridge(): void {
  ipcBridge.speechToText.transcribe.provider(async (request) => {
    return SpeechToTextService.transcribe(request);
  });

  ipcBridge.speechToText.local.status.provider(async () => {
    return { success: true, data: toRuntimeStatus(getManagedWhisperServerStatus()) };
  });

  ipcBridge.speechToText.local.getExecutableStatus.provider(async () => {
    const config = await ProcessConfig.get('tools.speechToText');
    const found = findWhisperServerExecutable(config?.whisperLocal?.executablePath);
    const status: WhisperExecutableStatus = { found: Boolean(found), path: found ?? undefined };
    return { success: true, data: status };
  });

  ipcBridge.speechToText.local.listModels.provider(async () => {
    return { success: true, data: WHISPER_MODEL_CATALOG.map(toModelInfo) };
  });

  ipcBridge.speechToText.local.downloadModel.provider(async ({ id }) => {
    const entry = findWhisperCatalogModel(id);
    if (!entry) {
      return { success: false, msg: `Unknown whisper model id: ${id}` };
    }
    const manager = createWhisperModelDownloadManager({
      onProgress: (progress) => ipcBridge.speechToText.local.downloadProgress.emit(progress),
    });
    try {
      await manager.start({
        id: entry.id,
        url: entry.url,
        destPath: path.join(getModelsDirectory(), entry.file),
        expectedSha256: entry.sha256,
        expectedBytes: entry.bytes,
      });
      return { success: true, data: toModelInfo(entry) };
    } catch (error) {
      mainError('[SpeechToText]', 'Whisper model download failed', { id, message: errorMessage(error) });
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.speechToText.local.start.provider(async ({ modelPath }) => {
    try {
      const config = await ProcessConfig.get('tools.speechToText');
      const handle = await startManagedWhisperServer({
        modelPath,
        allowedRoots: [getModelsDirectory()],
        executablePath: config?.whisperLocal?.executablePath,
        language: config?.whisperLocal?.language,
      });
      // Remember the last-used model so the settings UI can pre-select it next time.
      await ProcessConfig.set('tools.speechToText', {
        ...(config ?? { enabled: false, provider: 'whisper-local' as const }),
        whisperLocal: { ...config?.whisperLocal, modelPath },
      });
      return { success: true, data: toRuntimeStatus(handle) };
    } catch (error) {
      stopManagedWhisperServer();
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.speechToText.local.stop.provider(async () => {
    stopManagedWhisperServer();
    return { success: true, data: { running: false } };
  });
}
