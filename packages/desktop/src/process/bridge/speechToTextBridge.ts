/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { WhisperLocalModel, WhisperLocalStatus } from '@/common/adapter/ipcBridge';
import { normalizeModelDirectories, resolveModelDirectories } from '@/common/utils/localModelProviders';
import {
  expandHomeDirectory,
  getDefaultLocalModelDirectories,
} from '@process/services/localModels/defaultModelDirectories';
import { ProcessConfig } from '@process/utils/initStorage';
import {
  getWhisperServerStatus,
  resolveInstalledWhisperExecutable,
  startWhisperServer,
  stopWhisperServer,
  type WhisperServerHandle,
} from '@process/services/whisper/WhisperRuntimeService';
import { WHISPER_MODEL_CATALOG, getWhisperCatalogEntry } from '@process/services/whisper/whisperCatalog';
import { downloadWhisperModel } from '@process/services/whisper/whisperModelDownloader';

/** Where downloaded ggml models live. Also the primary root of the path jail. */
export function getWhisperModelsDirectory(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

/**
 * Roots a model may be loaded from: the app's own whisper directory plus any
 * local-model directory the user already configured (people keep their ggml
 * files next to their GGUF ones).
 */
async function getAllowedRoots(): Promise<string[]> {
  const configured = await ProcessConfig.get('localModel.directories');
  const rawList = resolveModelDirectories(configured, getDefaultLocalModelDirectories());
  return normalizeModelDirectories([getWhisperModelsDirectory(), ...rawList.map(expandHomeDirectory)]);
}

function toStatus(handle: WhisperServerHandle | null): WhisperLocalStatus {
  if (!handle) return { running: false };
  return { running: true, baseUrl: handle.baseUrl, modelPath: handle.modelPath, port: handle.port };
}

function listCatalogModels(): WhisperLocalModel[] {
  const directory = getWhisperModelsDirectory();
  return WHISPER_MODEL_CATALOG.map((entry) => {
    const target = path.join(directory, entry.fileName);
    const downloaded = existsSync(target) && statSync(target).isFile();
    return {
      id: entry.id,
      fileName: entry.fileName,
      label: entry.label,
      sizeBytes: entry.sizeBytes,
      downloaded,
      path: downloaded ? target : undefined,
    };
  });
}

/** Stop the managed `whisper-server`. Exported for the app `before-quit` hook. */
export function stopLocalWhisperServer(): void {
  stopWhisperServer();
}

export function initSpeechToTextBridge(): void {
  ipcBridge.speechToText.local.getExecutableStatus.provider(async () => {
    const executablePath = resolveInstalledWhisperExecutable();
    return {
      success: true,
      data: {
        installed: Boolean(executablePath),
        executablePath: executablePath ?? undefined,
        platform: process.platform,
      },
    };
  });

  ipcBridge.speechToText.local.status.provider(async () => {
    return { success: true, data: toStatus(getWhisperServerStatus()) };
  });

  ipcBridge.speechToText.local.listModels.provider(async () => {
    try {
      return { success: true, data: listCatalogModels() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.speechToText.local.start.provider(async ({ modelPath }) => {
    try {
      const speechConfig = await ProcessConfig.get('tools.speechToText');
      const handle = await startWhisperServer({
        modelPath,
        allowedRoots: await getAllowedRoots(),
        language: speechConfig?.whisperLocal?.language,
        translate: speechConfig?.whisperLocal?.translate,
      });
      return { success: true, data: toStatus(handle) };
    } catch (error) {
      // Never leave a half-started server behind on failure.
      stopWhisperServer();
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.speechToText.local.stop.provider(async () => {
    stopWhisperServer();
    return { success: true, data: { running: false } };
  });

  ipcBridge.speechToText.local.downloadModel.provider(async ({ id }) => {
    const entry = getWhisperCatalogEntry(id);
    if (!entry) {
      return { success: false, msg: `Unknown whisper model "${id}"` };
    }
    try {
      const target = await downloadWhisperModel({
        entry,
        targetDirectory: getWhisperModelsDirectory(),
        onProgress: (progress) => ipcBridge.speechToText.local.downloadProgress.emit(progress),
      });
      return { success: true, data: { path: target } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
