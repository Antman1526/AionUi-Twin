/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelRuntimeStatus } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import { normalizeModelDirectories, resolveModelDirectories } from '@/common/utils/localModelProviders';
import { ProcessConfig } from '@process/utils/initStorage';
import { scanLocalModelDirectories } from '@process/services/localModels/LocalModelDiscoveryService';
import {
  createLocalProviderFromRuntime,
  getManagedServerStatus,
  replaceManagedProvider,
  startManagedLlamaServer,
  stopManagedLlamaServer,
  type ManagedServerHandle,
} from '@process/services/localModels/LocalModelRuntimeService';

/** Effective scan directories: the user's configured list, or built-in defaults. */
async function getModelDirectories(): Promise<string[]> {
  return resolveModelDirectories(await ProcessConfig.get('localModel.directories'));
}

function toStatus(handle: ManagedServerHandle | null): LocalModelRuntimeStatus {
  if (!handle) return { running: false };
  return {
    running: true,
    modelPath: handle.modelPath,
    name: handle.alias,
    port: handle.port,
    baseUrl: handle.baseUrl,
  };
}

/**
 * Replace the managed local provider in `model.config` with `next` (or remove it
 * when `next` is null). Only entries whose id starts with the managed prefix are
 * touched, so user-defined providers are never modified.
 */
async function upsertManagedProvider(next: IProvider | null): Promise<void> {
  const existing = await ProcessConfig.get('model.config');
  const list: IProvider[] = Array.isArray(existing) ? existing : [];
  await ProcessConfig.set('model.config', replaceManagedProvider(list, next));
}

/**
 * Stop the managed llama-server and drop its provider. Exported for the
 * app `before-quit` cleanup so no orphaned process survives shutdown.
 */
export async function stopLocalModelServer(): Promise<void> {
  stopManagedLlamaServer();
  try {
    await upsertManagedProvider(null);
  } catch {
    /* config may be unavailable during shutdown */
  }
}

export function initLocalModelBridge(): void {
  ipcBridge.localModel.listModels.provider(async () => {
    try {
      const result = await scanLocalModelDirectories({ roots: await getModelDirectories() });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.localModel.start.provider(async ({ modelPath }) => {
    try {
      const handle = await startManagedLlamaServer({
        modelPath,
        allowedRoots: await getModelDirectories(),
      });
      const provider = createLocalProviderFromRuntime({
        runtime: 'llama.cpp',
        name: handle.alias,
        baseUrl: handle.baseUrl,
        models: [handle.alias],
      });
      await upsertManagedProvider(provider);
      return { success: true, data: toStatus(handle) };
    } catch (error) {
      // Ensure we never leave a half-started server behind on failure.
      stopManagedLlamaServer();
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.localModel.stop.provider(async () => {
    await stopLocalModelServer();
    return { success: true, data: { running: false } };
  });

  ipcBridge.localModel.getStatus.provider(async () => {
    return { success: true, data: toStatus(getManagedServerStatus()) };
  });

  ipcBridge.localModel.getDirectories.provider(async () => {
    return { success: true, data: await getModelDirectories() };
  });

  ipcBridge.localModel.setDirectories.provider(async ({ directories }) => {
    try {
      await ProcessConfig.set('localModel.directories', normalizeModelDirectories(directories));
      return { success: true, data: await getModelDirectories() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
