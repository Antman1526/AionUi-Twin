/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { chunkRowId, chunkText, fileChunkRowId, workspaceConversationId } from './chunking';
import { EMBED_BATCH_SIZE } from './EmbeddingClient';
import type { EmbeddingRowInput } from './SemanticSearchRepository';
import type { SemanticIndexProgress } from './types';
import { collectWorkspaceFiles, readTextFile } from './workspaceFiles';

/** Page size used when pulling a conversation's messages for indexing. */
export const MESSAGE_PAGE_SIZE = 500;

/** Subset of the conversation repository the indexer needs. */
export type IndexerConversationSource = {
  listAllConversations(): Promise<TChatConversation[]>;
  getMessages(
    id: string,
    page: number,
    pageSize: number,
    order?: 'ASC' | 'DESC'
  ): Promise<{ data: TMessage[]; total: number; hasMore: boolean }>;
};

/** Subset of {@link SemanticSearchRepository} the indexer needs. */
export type IndexerStore = {
  getUpdatedAtMap(conversationId: string): Map<string, number>;
  upsertMany(rows: readonly EmbeddingRowInput[]): void;
};

/** Turns a batch of strings into vectors, in input order. */
export type Embedder = (inputs: string[]) => Promise<number[][]>;

/** Result of one index run. */
export type IndexRunResult = {
  indexed: number;
  total: number;
  cancelled: boolean;
};

type IndexOptions = {
  store: IndexerStore;
  embed: Embedder;
  model: string;
  onProgress?: (progress: SemanticIndexProgress) => void;
  shouldCancel?: () => boolean;
  now?: () => number;
};

/** Plain text of a message, or empty when it carries no indexable text. */
export function messageText(message: TMessage): string {
  const content = message.content as { content?: unknown } | undefined;
  const value = content?.content;
  return typeof value === 'string' ? value.trim() : '';
}

/** A single unit of work: one chunk that may need embedding. */
type PendingChunk = {
  rowId: string;
  conversationId: string;
  text: string;
  sourceUpdatedAt: number;
};

/**
 * Embed and store the chunks that are not already up to date.
 *
 * Progress is reported per chunk considered (not per chunk embedded) so a
 * mostly-fresh index still walks the bar to 100%.
 */
async function embedPending(
  pending: PendingChunk[],
  skipped: number,
  { store, embed, model, onProgress, shouldCancel, now = Date.now }: IndexOptions
): Promise<IndexRunResult> {
  const total = pending.length + skipped;
  let indexed = skipped;
  // Cancelling during collection lands here with nothing pending; report it as a
  // cancellation rather than as a finished run over an empty set.
  if (shouldCancel?.()) {
    onProgress?.({ indexed, total, state: 'cancelled' });
    return { indexed, total, cancelled: true };
  }
  onProgress?.({ indexed, total, state: 'running' });

  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH_SIZE) {
    if (shouldCancel?.()) {
      onProgress?.({ indexed, total, state: 'cancelled' });
      return { indexed, total, cancelled: true };
    }
    const batch = pending.slice(offset, offset + EMBED_BATCH_SIZE);
    const vectors = await embed(batch.map((chunk) => chunk.text));
    const timestamp = now();
    store.upsertMany(
      batch.map((chunk, position) => ({
        messageId: chunk.rowId,
        conversationId: chunk.conversationId,
        model,
        vector: vectors[position],
        updatedAt: Math.max(timestamp, chunk.sourceUpdatedAt),
      }))
    );
    indexed += batch.length;
    onProgress?.({ indexed, total, state: 'running' });
  }

  onProgress?.({ indexed, total, state: 'done' });
  return { indexed, total, cancelled: false };
}

/**
 * Index every text message of every conversation.
 *
 * A chunk is re-embedded only when its stored `updated_at` is older than the
 * message's own timestamp, so repeated runs are cheap.
 */
export async function indexConversations(
  source: IndexerConversationSource,
  options: IndexOptions
): Promise<IndexRunResult> {
  const conversations = await source.listAllConversations();
  const pending: PendingChunk[] = [];
  let skipped = 0;

  for (const conversation of conversations) {
    if (options.shouldCancel?.()) break;
    const existing = options.store.getUpdatedAtMap(conversation.id);
    const { data } = await source.getMessages(conversation.id, 0, MESSAGE_PAGE_SIZE, 'ASC');
    for (const message of data) {
      const text = messageText(message);
      if (!text) continue;
      const sourceUpdatedAt = message.createdAt ?? conversation.modifyTime ?? conversation.createTime ?? 0;
      chunkText(text).forEach((chunk, index) => {
        const rowId = chunkRowId(message.id, index);
        const storedAt = existing.get(rowId);
        if (storedAt !== undefined && storedAt >= sourceUpdatedAt) {
          skipped += 1;
          return;
        }
        pending.push({ rowId, conversationId: conversation.id, text: chunk, sourceUpdatedAt });
      });
    }
  }

  return embedPending(pending, skipped, options);
}

/**
 * Index the text files of a workspace directory into the same table, under the
 * synthetic conversation id `workspace:<workspacePath>`.
 */
export async function indexWorkspace(workspacePath: string, options: IndexOptions): Promise<IndexRunResult> {
  const conversationId = workspaceConversationId(workspacePath);
  const existing = options.store.getUpdatedAtMap(conversationId);
  const files = await collectWorkspaceFiles(workspacePath);
  const pending: PendingChunk[] = [];
  let skipped = 0;

  for (const file of files) {
    if (options.shouldCancel?.()) break;
    const text = await readTextFile(file.absolutePath);
    if (!text) continue;
    chunkText(text).forEach((chunk, index) => {
      const rowId = fileChunkRowId(file.relativePath, index);
      const storedAt = existing.get(rowId);
      if (storedAt !== undefined && storedAt >= file.modifiedAt) {
        skipped += 1;
        return;
      }
      pending.push({ rowId, conversationId, text: chunk, sourceUpdatedAt: file.modifiedAt });
    });
  }

  return embedPending(pending, skipped, options);
}
