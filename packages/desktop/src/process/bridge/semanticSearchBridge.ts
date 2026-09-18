/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type {
  SemanticEmbeddingCandidate,
  SemanticIndexProgress,
  SemanticSearchHit,
  SemanticSearchSettings,
  SemanticSearchStats,
} from '@/common/adapter/ipcBridge';
import type { SemanticSearchSource, TChatConversation } from '@/common/config/storage';
import type { TMessage } from '@/common/chat/chatLib';
import { normalizeModelDirectories, resolveModelDirectories } from '@/common/utils/localModelProviders';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { resolveLegacyDatabasePath } from '@process/services/database/runLegacyDatabaseMigrations';
import { CURRENT_DB_VERSION, initSchema, setDatabaseVersion } from '@process/services/database/schema';
import {
  expandHomeDirectory,
  getDefaultLocalModelDirectories,
} from '@process/services/localModels/defaultModelDirectories';
import { scanLocalModelDirectories } from '@process/services/localModels/LocalModelDiscoveryService';
import { chunkText, parseRowId } from '@process/services/semanticSearch/chunking';
import {
  ensureEmbeddingRuntime,
  getEmbeddingRuntimeStatus,
  looksLikeEmbeddingModel,
  requestEmbeddings,
  stopEmbeddingRuntime,
} from '@process/services/semanticSearch/EmbeddingRuntime';
import { EmbeddingStore } from '@process/services/semanticSearch/EmbeddingStore';
import {
  indexConversations,
  indexWorkspace,
  type CancellationSignal,
  type Embedder,
  type IndexProgress,
} from '@process/services/semanticSearch/SemanticIndexer';
import { queryIndex } from '@process/services/semanticSearch/SemanticQuery';
import { collectWorkspaceFiles, readWorkspaceTextFile } from '@process/services/semanticSearch/workspaceFiles';
import { isKnownWorkspace, isWorkspaceConversationId } from '@process/services/semanticSearch/workspaceGuard';
import { ensureDirectory } from '@process/utils';
import { ProcessConfig } from '@process/utils/initStorage';

const DEFAULT_QUERY_LIMIT = 20;
const MAX_QUERY_LIMIT = 100;
const CONVERSATION_PAGE_LIMIT = 10_000;
const MESSAGE_PAGE_LIMIT = 200;

let store: EmbeddingStore | null = null;
let driver: ISqliteDriver | null = null;
let activeRun: CancellationSignal | null = null;
/** Conversation titles captured during the last listing, used to label hits. */
const conversationTitles = new Map<string, string>();

function failure(error: unknown): { success: false; msg: string } {
  return { success: false, msg: error instanceof Error ? error.message : String(error) };
}

/**
 * Open (creating if needed) the SQLite catalog that holds the embedding table.
 *
 * A brand-new file is initialized to the current baseline so the startup
 * migration pass sees an up-to-date catalog rather than a partial one.
 */
async function getStore(): Promise<EmbeddingStore> {
  if (store) return store;

  const dbPath = resolveLegacyDatabasePath();
  const existed = existsSync(dbPath);
  ensureDirectory(path.dirname(dbPath));

  const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
  driver = new BetterSqlite3Driver(dbPath);
  if (!existed) {
    initSchema(driver);
    setDatabaseVersion(driver, CURRENT_DB_VERSION);
  }
  store = new EmbeddingStore(driver);
  store.ensureSchema();
  return store;
}

/** Effective local model directories — same resolution the local model bridge uses. */
async function getModelDirectories(): Promise<string[]> {
  const configured = await ProcessConfig.get('localModel.directories');
  const rawList = resolveModelDirectories(configured, getDefaultLocalModelDirectories());
  return normalizeModelDirectories(rawList.map(expandHomeDirectory));
}

async function getSettings(): Promise<SemanticSearchSettings> {
  const [enabled, source] = await Promise.all([
    ProcessConfig.get('semanticSearch.enabled'),
    ProcessConfig.get('semanticSearch.source'),
  ]);
  return { enabled: enabled === true, source: (source as SemanticSearchSource | undefined) ?? null };
}

function emitProgress(progress: SemanticIndexProgress): void {
  ipcBridge.semanticSearch.progress.emit(progress);
}

const forwardProgress = (progress: IndexProgress): void => emitProgress(progress);

/** Spawn/attach the embedding server described by the saved settings. */
async function getEmbedder(): Promise<Embedder> {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new Error('Semantic search is disabled');
  }
  if (!settings.source) {
    throw new Error('No embedding model configured for semantic search');
  }

  const handle = await ensureEmbeddingRuntime({
    source: settings.source,
    allowedRoots: await getModelDirectories(),
  });

  return {
    model: handle.model,
    embed: (inputs) => requestEmbeddings({ baseUrl: handle.baseUrl, model: handle.model, inputs }),
  };
}

/** Plain text of a message, or '' for non-text message types. */
function messageText(message: TMessage): string {
  if (message.type !== 'text') return '';
  const content = message.content?.content;
  return typeof content === 'string' ? content : '';
}

async function listConversationRows(): Promise<TChatConversation[]> {
  const page = await ipcBridge.database.getUserConversations.invoke({ limit: CONVERSATION_PAGE_LIMIT });
  const items = Array.isArray(page?.items) ? page.items : [];
  conversationTitles.clear();
  for (const conversation of items) {
    conversationTitles.set(conversation.id, conversation.name ?? '');
  }
  return items;
}

/** Walk one conversation's message history oldest-first, following the cursor. */
async function listConversationMessages(conversationId: string): Promise<TMessage[]> {
  const pages: TMessage[][] = [];
  let before: string | undefined;
  let hasMoreBefore = true;

  while (hasMoreBefore) {
    const page = await ipcBridge.database.getConversationMessages.invoke({
      conversation_id: conversationId,
      limit: MESSAGE_PAGE_LIMIT,
      content_mode: 'full',
      ...(before ? { before } : {}),
    });
    pages.unshift(page.items ?? []);
    before = page.oldest_cursor ?? undefined;
    hasMoreBefore = Boolean(page.has_more_before && before);
  }

  return pages.flat();
}

/**
 * Re-derive the chunk text behind a hit. Only the top-k rows are resolved, so
 * refetching the source is cheaper than duplicating every chunk in the table.
 */
async function resolveSnippet(row: { rowId: string; conversationId: string }): Promise<string> {
  const parsed = parseRowId(row.rowId);
  if (!parsed) return '';

  try {
    if (isWorkspaceConversationId(row.conversationId)) {
      const workspacePath = row.conversationId.slice('workspace:'.length);
      const relativePath = parsed.key.startsWith('file:') ? parsed.key.slice('file:'.length) : parsed.key;
      const file = await readWorkspaceTextFile(workspacePath, relativePath);
      if (!file) return '';
      return chunkText(file.text)[parsed.chunkIndex] ?? '';
    }

    const message = await ipcBridge.database.getConversationMessage.invoke({
      conversation_id: row.conversationId,
      message_id: parsed.key,
    });
    if (!message) return '';
    return chunkText(messageText(message))[parsed.chunkIndex] ?? '';
  } catch {
    return '';
  }
}

async function runIndexConversations(): Promise<{ indexed: number; skipped: number; cancelled: boolean }> {
  const embedder = await getEmbedder();
  const embeddingStore = await getStore();
  const signal: CancellationSignal = { aborted: false };
  activeRun = signal;

  try {
    return await indexConversations({
      source: {
        listConversations: async () =>
          (await listConversationRows()).map((conversation) => ({
            id: conversation.id,
            title: conversation.name ?? '',
          })),
        listMessages: async (conversationId) =>
          (await listConversationMessages(conversationId))
            .map((message) => ({
              id: message.id,
              createdAt: message.created_at ?? 0,
              text: messageText(message),
            }))
            .filter((message) => message.text.trim().length > 0),
      },
      embedder,
      store: embeddingStore,
      onProgress: forwardProgress,
      signal,
    });
  } finally {
    if (activeRun === signal) activeRun = null;
  }
}

export function initSemanticSearchBridge(): void {
  ipcBridge.semanticSearch.getSettings.provider(async () => {
    try {
      return { success: true, data: await getSettings() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.semanticSearch.setSettings.provider(async (next) => {
    try {
      if (next.enabled !== undefined) {
        await ProcessConfig.set('semanticSearch.enabled', next.enabled === true);
        if (next.enabled !== true) stopEmbeddingRuntime();
      }
      if (next.source !== undefined) {
        await ProcessConfig.set('semanticSearch.source', next.source ?? undefined);
        stopEmbeddingRuntime();
      }
      return { success: true, data: await getSettings() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.semanticSearch.getStats.provider(async () => {
    try {
      const settings = await getSettings();
      const stats = (await getStore()).stats();
      const data: SemanticSearchStats = {
        enabled: settings.enabled,
        running: getEmbeddingRuntimeStatus() !== null,
        ...stats,
      };
      return { success: true, data };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.semanticSearch.listEmbeddingModels.provider(async () => {
    try {
      const scan = await scanLocalModelDirectories({ roots: await getModelDirectories() });
      const data: SemanticEmbeddingCandidate[] = scan.models
        .filter(
          (model) =>
            model.kind === 'llm' &&
            (looksLikeEmbeddingModel(model.name) || looksLikeEmbeddingModel(path.basename(model.path)))
        )
        .map((model) => ({ path: model.path, name: model.name, sizeBytes: model.sizeBytes }));
      return { success: true, data };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.semanticSearch.rebuild.provider(async () => {
    if (activeRun) return { success: false, msg: 'An index run is already in progress' };
    try {
      const result = await runIndexConversations();
      return { success: true, data: result };
    } catch (error) {
      emitProgress({ phase: 'error', processed: 0, total: 0, error: String(error) });
      return failure(error);
    }
  });

  ipcBridge.semanticSearch.indexWorkspace.provider(async ({ workspacePath }) => {
    if (activeRun) return { success: false, msg: 'An index run is already in progress' };
    const signal: CancellationSignal = { aborted: false };
    try {
      // `workspacePath` crosses IPC, which the WebUI can reach: only a directory
      // that is already the workspace of an existing conversation may be walked.
      const conversations = await listConversationRows();
      if (!isKnownWorkspace(workspacePath, conversations)) {
        return { success: false, msg: 'Refusing to index a path that is not a known conversation workspace' };
      }

      const root = path.resolve(workspacePath);
      const embedder = await getEmbedder();
      const embeddingStore = await getStore();
      activeRun = signal;

      const result = await indexWorkspace({
        workspacePath: root,
        files: await collectWorkspaceFiles(root),
        readFile: (relativePath) => readWorkspaceTextFile(root, relativePath),
        embedder,
        store: embeddingStore,
        onProgress: forwardProgress,
        signal,
      });
      return { success: true, data: result };
    } catch (error) {
      emitProgress({ phase: 'error', processed: 0, total: 0, error: String(error) });
      return failure(error);
    } finally {
      if (activeRun === signal) activeRun = null;
    }
  });

  ipcBridge.semanticSearch.cancel.provider(async () => {
    if (activeRun) activeRun.aborted = true;
    return { success: true, data: undefined };
  });

  ipcBridge.semanticSearch.clear.provider(async () => {
    try {
      (await getStore()).clear();
      stopEmbeddingRuntime();
      return { success: true, data: undefined };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.semanticSearch.query.provider(async ({ text, limit, scope }) => {
    try {
      const embedder = await getEmbedder();
      const embeddingStore = await getStore();
      if (conversationTitles.size === 0) {
        // Titles are only cached while indexing; refresh them for a cold query.
        await listConversationRows().catch((): TChatConversation[] => []);
      }
      const hits: SemanticSearchHit[] = await queryIndex({
        text,
        limit: Math.min(Math.max(1, limit ?? DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT),
        scope,
        embedder,
        store: embeddingStore,
        resolveSnippet,
        resolveTitle: (conversationId) => conversationTitles.get(conversationId) ?? '',
      });
      return { success: true, data: hits };
    } catch (error) {
      return failure(error);
    }
  });

  // The embedding server is a child process we own; it must not outlive the app.
  app?.on?.('before-quit', () => {
    if (activeRun) activeRun.aborted = true;
    stopEmbeddingRuntime();
    try {
      driver?.close();
    } catch {
      /* already closed */
    }
    driver = null;
    store = null;
  });
}
