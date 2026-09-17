/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type {
  LocalModelCatalogEntry,
  LocalModelExecutableStatus,
  LocalModelInfo,
  LocalModelRuntimeStatus,
} from '@/common/adapter/ipcBridge';
import type { IProvider, LocalModelRuntimeOptions } from '@/common/config/storage';
import { normalizeModelDirectories, resolveModelDirectories } from '@/common/utils/localModelProviders';
import { getDefaultLocalModelDirectories } from '@process/services/localModels/defaultModelDirectories';
import { LLAMA_SERVER_BASENAMES, validateExecutablePath } from '@process/services/security/executableValidation';
import { GGUF_MODEL_EXTENSIONS, validateModelFile } from '@process/services/security/modelPathValidation';
import { ProcessConfig } from '@process/utils/initStorage';
import { scanLocalModelDirectories } from '@process/services/localModels/LocalModelDiscoveryService';
import { readGgufMetadata, type GgufMetadata } from '@process/services/localModels/ggufMetadata';
import { catalogDownloadUrl, findCatalogModel, MODEL_CATALOG } from '@process/services/localModels/modelCatalog';
import { createModelDownloadManager } from '@process/services/localModels/modelDownloadManager';
import { estimateModelFit, type ModelFitEstimate } from '@process/services/localModels/modelFit';
import {
  createLocalProviderFromRuntime,
  findLlamaServerExecutable,
  getManagedServerStatus,
  replaceManagedProvider,
  startManagedLlamaServer,
  stopManagedLlamaServer,
  type ManagedServerExit,
  type ManagedServerHandle,
} from '@process/services/localModels/LocalModelRuntimeService';

/** Effective scan directories: the user's configured list, or derived defaults. */
async function getModelDirectories(): Promise<string[]> {
  return resolveModelDirectories(await ProcessConfig.get('localModel.directories'), getDefaultLocalModelDirectories());
}

/**
 * Reject a scan directory that is not an existing directory.
 *
 * The configured list doubles as the jail for `localModel.start`, so accepting
 * arbitrary strings here would let a caller widen the jail to anything.
 */
function assertExistingDirectory(directory: string): void {
  const resolved = path.resolve(directory);
  let isDirectory = false;
  try {
    isDirectory = statSync(resolved).isDirectory();
  } catch {
    throw new Error(`Not a directory: ${directory}`);
  }
  if (!isDirectory) throw new Error(`Not a directory: ${directory}`);
}

const MIN_CONTEXT_SIZE = 512;
const MAX_CONTEXT_SIZE = 262_144;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 900_000;
/** Ceiling used when a model's trained context is unknown, matching the previous blind default. */
const FALLBACK_TRAINED_CONTEXT = 16_384;

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
  if (options.embedding === true) next.embedding = true;
  return next;
}

async function getRuntimeOptionsMap(): Promise<Record<string, LocalModelRuntimeOptions>> {
  const stored = await ProcessConfig.get('localModel.runtimeOptions');
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

async function getRuntimeOptions(
  modelPath: string,
  incoming?: LocalModelRuntimeOptions
): Promise<LocalModelRuntimeOptions> {
  if (incoming) return normalizeRuntimeOptions(incoming);
  const stored = await getRuntimeOptionsMap();
  return normalizeRuntimeOptions(stored[modelPath]);
}

async function saveRuntimeOptions(
  modelPath: string,
  options: LocalModelRuntimeOptions
): Promise<LocalModelRuntimeOptions> {
  const normalized = normalizeRuntimeOptions(options);
  const stored = await getRuntimeOptionsMap();
  await ProcessConfig.set('localModel.runtimeOptions', { ...stored, [modelPath]: normalized });
  return normalized;
}

/**
 * Memory-fit estimate for a model, using its GGUF header when readable. Falls
 * back to a size-only estimate so an unparsable file still gets a verdict.
 */
function estimateFit(sizeBytes: number, metadata: GgufMetadata | null): ModelFitEstimate {
  return estimateModelFit({
    sizeBytes,
    contextSize: metadata?.contextLength ?? FALLBACK_TRAINED_CONTEXT,
    blockCount: metadata?.blockCount,
    embeddingLength: metadata?.embeddingLength,
    headCount: metadata?.headCount,
    headCountKv: metadata?.headCountKv,
    totalMemoryBytes: os.totalmem(),
    platform: process.platform,
    arch: process.arch,
  });
}

async function readMetadataOrNull(modelPath: string): Promise<GgufMetadata | null> {
  try {
    return await readGgufMetadata(modelPath);
  } catch {
    return null;
  }
}

/**
 * Runtime options to launch with when the user saved none: the hardware-fit
 * recommendation rather than a blind 99 GPU layers at 16k context.
 */
async function recommendedRuntimeOptions(modelPath: string): Promise<LocalModelRuntimeOptions> {
  try {
    const { size } = await fs.stat(modelPath);
    const fit = estimateFit(size, await readMetadataOrNull(modelPath));
    return { contextSize: fit.recommended.contextSize, gpuLayers: fit.recommended.gpuLayers };
  } catch {
    return {};
  }
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
 * Drop managed llama.cpp providers left over from a previous run.
 *
 * No managed server survives an app restart, so any `local-llama-cpp-*` entry
 * still in `model.config` at startup points at a dead port and must go.
 */
export async function purgeStaleManagedProviders(): Promise<void> {
  if (getManagedServerStatus() !== null) return;
  const existing = await ProcessConfig.get('model.config');
  const list: IProvider[] = Array.isArray(existing) ? existing : [];
  const purged = replaceManagedProvider(list, null);
  if (purged.length !== list.length) {
    await ProcessConfig.set('model.config', purged);
  }
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

/**
 * React to a managed server that exited on its own: the provider now points at a
 * dead port, so remove it and tell the renderer why the model disappeared.
 */
async function handleManagedServerExit(exit: ManagedServerExit): Promise<void> {
  if (!exit.expected) {
    try {
      await upsertManagedProvider(null);
    } catch {
      /* config write failures must not swallow the crash notification */
    }
  }
  ipcBridge.localModel.runtimeChanged.emit({
    status: exit.expected ? 'stopped' : 'crashed',
    modelPath: exit.modelPath,
    exitCode: exit.exitCode,
    signal: exit.signal,
    stderrTail: exit.stderrTail,
  });
}

async function readExecutableStatus(): Promise<LocalModelExecutableStatus> {
  const configuredPath = await ProcessConfig.get('localModel.executablePath');
  const resolved = findLlamaServerExecutable(configuredPath || undefined);
  const status: LocalModelExecutableStatus = { found: resolved !== null, platform: process.platform };
  if (resolved) status.path = resolved;
  if (configuredPath && resolved === configuredPath) status.configured = true;
  return status;
}

/**
 * Directory catalog downloads are written to: the first configured directory that
 * exists, otherwise a freshly created `<userData>/models` which is added to the
 * configured list so the new file is discovered by the next scan.
 */
async function resolveDownloadDirectory(): Promise<string> {
  const directories = await getModelDirectories();
  const existing = directories.find((dir) => existsSync(dir));
  if (existing) return existing;

  const fallback = path.join(app.getPath('userData'), 'models');
  await fs.mkdir(fallback, { recursive: true });
  await ProcessConfig.set('localModel.directories', normalizeModelDirectories([...directories, fallback]));
  return fallback;
}

/** Locate an already-downloaded catalog file by name across the configured directories. */
async function findInstalledCatalogFile(fileName: string): Promise<string | undefined> {
  const { models } = await scanLocalModelDirectories({ roots: await getModelDirectories() });
  return models.find((model) => path.basename(model.path) === fileName)?.path;
}

const downloadManager = createModelDownloadManager({
  onProgress: (progress) => ipcBridge.localModel.downloadProgress.emit(progress),
});

export function initLocalModelBridge(): void {
  void purgeStaleManagedProviders().catch((): undefined => undefined);

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
      const allowedRoots = await getModelDirectories();
      validateModelFile(modelPath, { allowedRoots, allowedExtensions: GGUF_MODEL_EXTENSIONS });
      const explicit = await getRuntimeOptions(modelPath, options);
      if (options) {
        await saveRuntimeOptions(modelPath, explicit);
      }
      const runtimeOptions =
        Object.keys(explicit).length > 0
          ? explicit
          : normalizeRuntimeOptions(await recommendedRuntimeOptions(modelPath));
      const executablePath = (await ProcessConfig.get('localModel.executablePath')) || undefined;
      const handle = await startManagedLlamaServer({
        modelPath,
        allowedRoots,
        executablePath,
        contextSize: runtimeOptions.contextSize,
        gpuLayers: runtimeOptions.gpuLayers,
        readinessTimeoutMs: runtimeOptions.readinessTimeoutMs,
        reasoning:
          runtimeOptions.reasoning === 'off' || runtimeOptions.reasoning === 'on'
            ? runtimeOptions.reasoning
            : undefined,
        embedding: runtimeOptions.embedding === true,
        onExit: (exit) => void handleManagedServerExit(exit),
      });
      const provider = createLocalProviderFromRuntime({
        runtime: 'llama.cpp',
        name: handle.alias,
        baseUrl: handle.baseUrl,
        models: [handle.alias],
      });
      await upsertManagedProvider(provider);
      ipcBridge.localModel.runtimeChanged.emit({ status: 'running', modelPath });
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
      const normalized = normalizeModelDirectories(directories);
      for (const directory of normalized) assertExistingDirectory(directory);
      await ProcessConfig.set('localModel.directories', normalized);
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

  ipcBridge.localModel.getExecutableStatus.provider(async () => {
    return { success: true, data: await readExecutableStatus() };
  });

  ipcBridge.localModel.setExecutablePath.provider(async ({ path: executablePath }) => {
    try {
      const trimmed = executablePath.trim();
      // An empty value clears the override; anything else must really be llama-server.
      if (trimmed) validateExecutablePath(trimmed, { allowedBasenames: LLAMA_SERVER_BASENAMES });
      await ProcessConfig.set('localModel.executablePath', trimmed);
      return { success: true, data: await readExecutableStatus() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.localModel.getModelInfo.provider(async ({ modelPath }) => {
    try {
      const roots = await getModelDirectories();
      if (!roots.some((root) => path.resolve(modelPath).startsWith(path.resolve(root) + path.sep))) {
        return { success: false, msg: 'Model is outside the configured local model directories' };
      }
      const [{ size }, metadata] = await Promise.all([fs.stat(modelPath), readGgufMetadata(modelPath)]);
      const info: LocalModelInfo = { modelPath, metadata, fit: estimateFit(size, metadata) };
      return { success: true, data: info };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.localModel.getCatalog.provider(async () => {
    try {
      const { models } = await scanLocalModelDirectories({ roots: await getModelDirectories() });
      const installed = new Map(models.map((model) => [path.basename(model.path), model.path]));
      const entries: LocalModelCatalogEntry[] = MODEL_CATALOG.map((model) => {
        const entry: LocalModelCatalogEntry = { ...model, url: catalogDownloadUrl(model) };
        const installedPath = installed.get(model.file);
        if (installedPath) entry.installedPath = installedPath;
        return entry;
      });
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.localModel.downloadCatalogModel.provider(async ({ id }) => {
    const model = findCatalogModel(id);
    if (!model) return { success: false, msg: `Unknown catalog model "${id}"` };
    try {
      const alreadyInstalled = await findInstalledCatalogFile(model.file);
      if (alreadyInstalled) return { success: true, data: { path: alreadyInstalled } };
      const destPath = path.join(await resolveDownloadDirectory(), model.file);
      await downloadManager.start({
        id: model.id,
        url: catalogDownloadUrl(model),
        destPath,
        expectedSha256: model.sha256,
        expectedBytes: model.bytes,
      });
      return { success: true, data: { path: destPath } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.localModel.cancelDownload.provider(async ({ id }) => {
    return downloadManager.cancel(id)
      ? { success: true, data: undefined }
      : { success: false, msg: `No download in progress for "${id}"` };
  });
}
