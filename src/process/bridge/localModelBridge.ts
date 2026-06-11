/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelRuntimeStatus } from '@/common/adapter/ipcBridge';
import type { IProvider, LocalModelRuntimeOptions } from '@/common/config/storage';
import { normalizeModelDirectories, resolveModelDirectories } from '@/common/utils/localModelProviders';
import { getDefaultLocalModelDirectories } from '@process/services/localModels/defaultModelDirectories';
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

/** Effective scan directories: the user's configured list, or derived defaults. */
async function getModelDirectories(): Promise<string[]> {
  return resolveModelDirectories(await ProcessConfig.get('localModel.directories'), getDefaultLocalModelDirectories());
}

const MIN_CONTEXT_SIZE = 512;
const MAX_CONTEXT_SIZE = 262_144;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 900_000;

function clampInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const integer = Math.round(value);
  return Math.min(Math.max(integer, min), max);
}

function normalizeRuntimeOptions(options?: LocalModelRuntimeOptions): LocalModelRuntimeOptions {
  if (!options) return {};
  const next: LocalModelRuntimeOptions = {};
  const contextSize = clampInteger(options.contextSize, MIN_CONTEXT_SIZE, MAX_CONTEXT_SIZE);
  const gpuLayers = clampInteger(options.gpuLayers, 0, 999);
  const readinessTimeoutMs = clampInteger(options.readinessTimeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  if (contextSize !== undefined) next.contextSize = contextSize;
  if (gpuLayers !== undefined) next.gpuLayers = gpuLayers;
  if (readinessTimeoutMs !== undefined) next.readinessTimeoutMs = readinessTimeoutMs;
  if (options.reasoning === 'off' || options.reasoning === 'on') next.reasoning = options.reasoning;
  return next;
}

async function getRuntimeOptionsMap(): Promise<Record<string, LocalModelRuntimeOptions>> {
  const stored = await ProcessConfig.get('localModel.runtimeOptions');
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

async function getRuntimeOptions(modelPath: string, incoming?: LocalModelRuntimeOptions): Promise<LocalModelRuntimeOptions> {
  if (incoming) return normalizeRuntimeOptions(incoming);
  const stored = await getRuntimeOptionsMap();
  return normalizeRuntimeOptions(stored[modelPath]);
}

async function saveRuntimeOptions(modelPath: string, options: LocalModelRuntimeOptions): Promise<LocalModelRuntimeOptions> {
  const normalized = normalizeRuntimeOptions(options);
  const stored = await getRuntimeOptionsMap();
  await ProcessConfig.set('localModel.runtimeOptions', { ...stored, [modelPath]: normalized });
  return normalized;
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

  ipcBridge.localModel.start.provider(async ({ modelPath, options }) => {
    try {
      const runtimeOptions = await getRuntimeOptions(modelPath, options);
      if (options) {
        await saveRuntimeOptions(modelPath, runtimeOptions);
      }
      const handle = await startManagedLlamaServer({
        modelPath,
        allowedRoots: await getModelDirectories(),
        contextSize: runtimeOptions.contextSize,
        gpuLayers: runtimeOptions.gpuLayers,
        readinessTimeoutMs: runtimeOptions.readinessTimeoutMs,
        reasoning:
          runtimeOptions.reasoning === 'off' || runtimeOptions.reasoning === 'on' ? runtimeOptions.reasoning : undefined,
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

  ipcBridge.localModel.getRuntimeOptions.provider(async () => {
    return { success: true, data: await getRuntimeOptionsMap() };
  });

  ipcBridge.localModel.setRuntimeOptions.provider(async ({ modelPath, options }) => {
    try {
      return { success: true, data: await saveRuntimeOptions(modelPath, options) };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
