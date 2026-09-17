/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { SemanticSearchSettingsView } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import { resolveModelDirectories } from '@/common/utils/localModelProviders';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { getDatabase } from '@process/services/database';
import { getDefaultLocalModelDirectories } from '@process/services/localModels/defaultModelDirectories';
import { GGUF_MODEL_EXTENSIONS, validateModelFile } from '@process/services/security/modelPathValidation';
import { isKnownWorkspace } from '@process/services/security/workspaceAllowlist';
import { embedTexts, MANAGED_EMBEDDING_MODEL } from '@process/services/semanticSearch/EmbeddingClient';
import { startEmbeddingRuntime, stopEmbeddingRuntime } from '@process/services/semanticSearch/EmbeddingRuntime';
import { indexConversations, indexWorkspace, type Embedder } from '@process/services/semanticSearch/Indexer';
import {
  SemanticSearchRepository,
  type EmbeddingRecord,
} from '@process/services/semanticSearch/SemanticSearchRepository';
import {
  DEFAULT_QUERY_LIMIT,
  filterByScope,
  searchVectors,
  VectorCache,
} from '@process/services/semanticSearch/SemanticSearchService';
import type { SemanticIndexProgress } from '@process/services/semanticSearch/types';
import { ProcessConfig } from '@process/utils/initStorage';

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Directories an embedding model may live in: the same jail `localModel.*` uses,
 * so semantic search cannot be turned into a wider filesystem reach than it.
 */
async function getLocalModelDirectories(): Promise<string[]> {
  return resolveModelDirectories(await ProcessConfig.get('localModel.directories'), getDefaultLocalModelDirectories());
}

/** Resolved embedding transport: a base URL plus the model name to send with it. */
type EmbeddingSource = { baseUrl: string; model: string; apiKey?: string };

let repository: SemanticSearchRepository | null = null;
let cache: VectorCache | null = null;
let cancelRequested = false;
let indexing = false;

async function getRepository(): Promise<SemanticSearchRepository> {
  if (!repository) {
    repository = new SemanticSearchRepository((await getDatabase()).getDriver());
  }
  return repository;
}

async function getCache(): Promise<VectorCache> {
  const repo = await getRepository();
  if (!cache) cache = new VectorCache(() => repo.listVectors());
  return cache;
}

async function readSettings(): Promise<SemanticSearchSettingsView> {
  const [enabled, embeddingModelPath, providerId, dimensions] = await Promise.all([
    ProcessConfig.get('semanticSearch.enabled'),
    ProcessConfig.get('semanticSearch.embeddingModelPath'),
    ProcessConfig.get('semanticSearch.providerId'),
    ProcessConfig.get('semanticSearch.dimensions'),
  ]);
  return {
    enabled: enabled === true,
    embeddingModelPath: embeddingModelPath || undefined,
    providerId: providerId || undefined,
    dimensions: typeof dimensions === 'number' ? dimensions : undefined,
    hasEmbeddingSource: Boolean(embeddingModelPath || providerId),
  };
}

/**
 * Pick the embedding transport: a user-configured OpenAI-compatible provider when
 * one is chosen, otherwise a dedicated `llama-server --embedding` started lazily.
 */
async function resolveEmbeddingSource(): Promise<EmbeddingSource> {
  const settings = await readSettings();
  if (settings.providerId) {
    const providers = await ProcessConfig.get('model.config');
    const provider = (Array.isArray(providers) ? providers : []).find(
      (entry: IProvider) => entry.id === settings.providerId
    );
    if (!provider?.baseUrl) throw new Error(`Embedding provider not found: ${settings.providerId}`);
    return {
      baseUrl: provider.baseUrl,
      model: Array.isArray(provider.model) ? (provider.model[0] ?? '') : '',
      apiKey: provider.apiKey || undefined,
    };
  }

  if (!settings.embeddingModelPath) {
    throw new Error('No embedding source configured for semantic search');
  }
  const executablePath = await ProcessConfig.get('localModel.executablePath');
  const handle = await startEmbeddingRuntime({
    modelPath: settings.embeddingModelPath,
    allowedRoots: await getLocalModelDirectories(),
    executablePath: executablePath || undefined,
  });
  return { baseUrl: handle.baseUrl, model: MANAGED_EMBEDDING_MODEL };
}

/** Embedder bound to the resolved source, recording the observed width once. */
async function createEmbedder(): Promise<{ embed: Embedder; model: string }> {
  const source = await resolveEmbeddingSource();
  const embed: Embedder = async (inputs) => {
    const vectors = await embedTexts({
      baseUrl: source.baseUrl,
      inputs,
      model: source.model,
      apiKey: source.apiKey,
    });
    const width = vectors[0]?.length;
    if (width && (await ProcessConfig.get('semanticSearch.dimensions')) !== width) {
      await ProcessConfig.set('semanticSearch.dimensions', width);
    }
    return vectors;
  };
  return { embed, model: source.model || MANAGED_EMBEDDING_MODEL };
}

function emitProgress(progress: SemanticIndexProgress): void {
  ipcBridge.semanticSearch.indexProgress.emit(progress);
}

/**
 * Register every `semanticSearch.*` IPC handler.
 *
 * @param repo Conversation repository used as the indexing and snippet source.
 */
export function initSemanticSearchBridge(repo: IConversationRepository): void {
  ipcBridge.semanticSearch.getSettings.provider(async () => {
    try {
      return { success: true, data: await readSettings() };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.semanticSearch.setSettings.provider(async (patch) => {
    try {
      if (patch.enabled !== undefined) await ProcessConfig.set('semanticSearch.enabled', patch.enabled);
      if (patch.embeddingModelPath !== undefined) {
        // The stored path is spawned with `llama-server -m`, so it is jailed here too.
        if (patch.embeddingModelPath) {
          validateModelFile(patch.embeddingModelPath, {
            allowedRoots: await getLocalModelDirectories(),
            allowedExtensions: GGUF_MODEL_EXTENSIONS,
          });
        }
        await ProcessConfig.set('semanticSearch.embeddingModelPath', patch.embeddingModelPath);
        stopEmbeddingRuntime();
      }
      if (patch.providerId !== undefined) await ProcessConfig.set('semanticSearch.providerId', patch.providerId);
      return { success: true, data: await readSettings() };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.semanticSearch.getStats.provider(async () => {
    try {
      return { success: true, data: (await getRepository()).stats() };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.semanticSearch.query.provider(async ({ text, limit, conversationId, scope = 'all' }) => {
    try {
      const trimmed = text.trim();
      if (!trimmed) return { success: true, data: [] };
      const settings = await readSettings();
      if (!settings.enabled) throw new Error('Semantic search is disabled');

      const { embed } = await createEmbedder();
      const [queryVector] = await embed([trimmed]);
      const store = await getRepository();
      const records: EmbeddingRecord[] = conversationId
        ? store.listVectors(conversationId)
        : filterByScope((await getCache()).get(), scope);

      const data = await searchVectors({
        queryVector: Float32Array.from(queryVector),
        records,
        conversations: await repo.listAllConversations(),
        source: repo,
        limit: limit ?? DEFAULT_QUERY_LIMIT,
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  const runIndex = async (job: (embed: Embedder, model: string) => Promise<unknown>) => {
    if (indexing) throw new Error('An index job is already running');
    indexing = true;
    cancelRequested = false;
    try {
      const { embed, model } = await createEmbedder();
      return await job(embed, model);
    } finally {
      indexing = false;
      (await getCache()).invalidate();
    }
  };

  ipcBridge.semanticSearch.rebuildIndex.provider(async () => {
    try {
      const store = await getRepository();
      const result = await runIndex((embed, model) =>
        indexConversations(repo, {
          store,
          embed,
          model,
          onProgress: emitProgress,
          shouldCancel: () => cancelRequested,
        })
      );
      return { success: true, data: result as { indexed: number; total: number; cancelled: boolean } };
    } catch (error) {
      emitProgress({ indexed: 0, total: 0, state: 'error', message: toMessage(error) });
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.semanticSearch.indexWorkspace.provider(async ({ workspacePath }) => {
    try {
      // Indexing reads every file under the directory, so only a workspace that
      // an existing conversation already owns may be named by the caller.
      if (!isKnownWorkspace(workspacePath, await repo.listAllConversations())) {
        throw new Error(`Refusing to index "${workspacePath}": it is not a known conversation workspace`);
      }
      const store = await getRepository();
      const result = await runIndex((embed, model) =>
        indexWorkspace(workspacePath, {
          store,
          embed,
          model,
          onProgress: emitProgress,
          shouldCancel: () => cancelRequested,
        })
      );
      return { success: true, data: result as { indexed: number; total: number; cancelled: boolean } };
    } catch (error) {
      emitProgress({ indexed: 0, total: 0, state: 'error', message: toMessage(error) });
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.semanticSearch.cancelIndex.provider(async () => {
    cancelRequested = true;
    return { success: true };
  });

  ipcBridge.semanticSearch.clearIndex.provider(async () => {
    try {
      (await getRepository()).clear();
      (await getCache()).invalidate();
      return { success: true };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  // The embedding server is a child process of this app; it must not outlive it.
  app.on('before-quit', stopEmbeddingRuntime);
}
