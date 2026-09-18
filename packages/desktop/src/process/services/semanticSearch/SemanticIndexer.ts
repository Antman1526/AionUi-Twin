/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { chunkText, fileRowId, messageRowId, type ChunkOptions } from './chunking';
import type { EmbeddingRow } from './EmbeddingStore';
import { workspaceConversationId } from './workspaceGuard';

/** Batched embedding backend — one HTTP round trip per call. */
export type Embedder = {
  model: string;
  embed(inputs: string[]): Promise<number[][]>;
};

/** Minimal persistence surface the indexer needs, so tests can fake it. */
export type IndexWritableStore = {
  getFreshness(conversationId: string, model: string): Map<string, number>;
  upsert(rows: readonly EmbeddingRow[]): void;
};

export type IndexableMessage = {
  id: string;
  createdAt: number;
  text: string;
};

export type IndexableConversation = {
  id: string;
  title: string;
};

export type ConversationSource = {
  listConversations(): Promise<IndexableConversation[]>;
  listMessages(conversationId: string): Promise<IndexableMessage[]>;
};

export type IndexPhase = 'idle' | 'conversations' | 'workspace' | 'done' | 'error';

export type IndexProgress = {
  phase: IndexPhase;
  processed: number;
  total: number;
  /** Conversation title or file path currently being embedded. */
  label?: string;
  error?: string;
};

export type IndexResult = {
  indexed: number;
  skipped: number;
  cancelled: boolean;
};

/** Inputs sent per embedding request. */
export const EMBED_BATCH_SIZE = 16;

export type CancellationSignal = { aborted: boolean };

type PendingChunk = {
  rowId: string;
  conversationId: string;
  text: string;
  updatedAt: number;
};

/**
 * Embed `pending` in batches and write the resulting rows. Returns the number of
 * chunks written; stops early (returning what it wrote) when cancelled.
 */
async function embedAndStore(
  pending: readonly PendingChunk[],
  embedder: Embedder,
  store: IndexWritableStore,
  signal?: CancellationSignal
): Promise<number> {
  let written = 0;
  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = pending.slice(offset, offset + EMBED_BATCH_SIZE);
    const vectors = await embedder.embed(batch.map((item) => item.text));
    const rows: EmbeddingRow[] = batch.map((item, index) => {
      const vector = Float32Array.from(vectors[index] ?? []);
      return {
        rowId: item.rowId,
        conversationId: item.conversationId,
        model: embedder.model,
        dims: vector.length,
        vector,
        updatedAt: item.updatedAt,
      };
    });
    store.upsert(rows);
    written += rows.length;
  }
  return written;
}

/**
 * Embed every text message of every conversation.
 *
 * Chunks whose stored row is at least as new as the message (and was written by
 * the same model) are skipped, so a re-run after a few new messages is cheap.
 */
export async function indexConversations({
  source,
  embedder,
  store,
  chunkOptions,
  onProgress,
  signal,
}: {
  source: ConversationSource;
  embedder: Embedder;
  store: IndexWritableStore;
  chunkOptions?: ChunkOptions;
  onProgress?: (progress: IndexProgress) => void;
  signal?: CancellationSignal;
}): Promise<IndexResult> {
  const conversations = await source.listConversations();
  let indexed = 0;
  let skipped = 0;

  for (const [position, conversation] of conversations.entries()) {
    if (signal?.aborted) {
      return { indexed, skipped, cancelled: true };
    }

    onProgress?.({
      phase: 'conversations',
      processed: position,
      total: conversations.length,
      label: conversation.title,
    });

    const messages = await source.listMessages(conversation.id);
    const freshness = store.getFreshness(conversation.id, embedder.model);
    const pending: PendingChunk[] = [];

    for (const message of messages) {
      const chunks = chunkText(message.text, chunkOptions);
      for (const [chunkIndex, text] of chunks.entries()) {
        const rowId = messageRowId(message.id, chunkIndex);
        const storedAt = freshness.get(rowId);
        if (storedAt !== undefined && storedAt >= message.createdAt) {
          skipped += 1;
          continue;
        }
        pending.push({ rowId, conversationId: conversation.id, text, updatedAt: message.createdAt });
      }
    }

    indexed += await embedAndStore(pending, embedder, store, signal);
  }

  onProgress?.({ phase: 'done', processed: conversations.length, total: conversations.length });
  return { indexed, skipped, cancelled: Boolean(signal?.aborted) };
}

/** A workspace file's text plus its last-modified time, or null when unreadable/binary. */
export type WorkspaceFileContent = { text: string; modifiedAt: number };

/**
 * Embed the text files of an already-authorized workspace. `files` holds
 * workspace-relative paths; `readFile` returns null for binary/unreadable files.
 * Files whose stored rows are at least as new as the file are skipped.
 */
export async function indexWorkspace({
  workspacePath,
  files,
  readFile,
  embedder,
  store,
  chunkOptions,
  onProgress,
  signal,
}: {
  workspacePath: string;
  files: readonly string[];
  readFile: (relativePath: string) => Promise<WorkspaceFileContent | null>;
  embedder: Embedder;
  store: IndexWritableStore;
  chunkOptions?: ChunkOptions;
  onProgress?: (progress: IndexProgress) => void;
  signal?: CancellationSignal;
}): Promise<IndexResult> {
  const conversationId = workspaceConversationId(workspacePath);
  const freshness = store.getFreshness(conversationId, embedder.model);
  let indexed = 0;
  let skipped = 0;

  for (const [position, relativePath] of files.entries()) {
    if (signal?.aborted) {
      return { indexed, skipped, cancelled: true };
    }

    onProgress?.({ phase: 'workspace', processed: position, total: files.length, label: relativePath });

    const file = await readFile(relativePath);
    if (file === null) {
      skipped += 1;
      continue;
    }

    const pending: PendingChunk[] = [];
    for (const [chunkIndex, text] of chunkText(file.text, chunkOptions).entries()) {
      const rowId = fileRowId(relativePath, chunkIndex);
      const storedAt = freshness.get(rowId);
      if (storedAt !== undefined && storedAt >= file.modifiedAt) {
        skipped += 1;
        continue;
      }
      pending.push({ rowId, conversationId, text, updatedAt: file.modifiedAt });
    }

    indexed += await embedAndStore(pending, embedder, store, signal);
  }

  onProgress?.({ phase: 'done', processed: files.length, total: files.length });
  return { indexed, skipped, cancelled: Boolean(signal?.aborted) };
}
