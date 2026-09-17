/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { TChatConversation } from '@/common/config/storage';
import { chunkText } from './chunking';
import type { IndexerConversationSource } from './Indexer';
import { messageText, MESSAGE_PAGE_SIZE } from './Indexer';
import type { EmbeddingRecord } from './SemanticSearchRepository';
import type { SemanticSearchHit, SemanticSearchScope } from './types';
import { cosineSimilarity, topK } from './vectors';
import { readTextFile } from './workspaceFiles';

/** Default number of hits returned by a query. */
export const DEFAULT_QUERY_LIMIT = 20;
/** Characters of a matched chunk shown in the result list. */
export const SNIPPET_MAX_LENGTH = 220;

/** Whether a stored `conversation_id` belongs to an indexed workspace rather than a chat. */
export function isWorkspaceConversationId(conversationId: string): boolean {
  return conversationId.startsWith('workspace:');
}

/** Absolute workspace path encoded in a `workspace:<path>` conversation id. */
export function workspacePathFromConversationId(conversationId: string): string {
  return conversationId.slice('workspace:'.length);
}

/** Split a stored row id back into its source id and chunk index. */
export function parseRowId(rowId: string): { sourceId: string; chunkIndex: number } {
  const separator = rowId.lastIndexOf('#');
  if (separator === -1) return { sourceId: rowId, chunkIndex: 0 };
  const chunkIndex = Number.parseInt(rowId.slice(separator + 1), 10);
  return {
    sourceId: rowId.slice(0, separator),
    chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : 0,
  };
}

/** Keep only the records belonging to the requested corpus. */
export function filterByScope(records: readonly EmbeddingRecord[], scope: SemanticSearchScope): EmbeddingRecord[] {
  if (scope === 'all') return [...records];
  const wantWorkspace = scope === 'workspace';
  return records.filter((record) => isWorkspaceConversationId(record.conversationId) === wantWorkspace);
}

function truncate(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > SNIPPET_MAX_LENGTH
    ? `${normalized.slice(0, SNIPPET_MAX_LENGTH).trimEnd()}...`
    : normalized;
}

/**
 * Text of one chunk, re-derived from its source.
 *
 * Chunk text is deliberately not stored alongside the vector — it would double
 * the table size, and only the handful of rows in a result page need it.
 */
async function resolveSnippet(
  record: EmbeddingRecord,
  source: IndexerConversationSource,
  messageCache: Map<string, Map<string, string>>
): Promise<string> {
  const { sourceId, chunkIndex } = parseRowId(record.messageId);
  if (isWorkspaceConversationId(record.conversationId)) {
    const relativePath = sourceId.replace(/^file:/, '');
    const workspacePath = workspacePathFromConversationId(record.conversationId);
    const text = await readTextFile(path.join(workspacePath, relativePath));
    return text ? truncate(chunkText(text)[chunkIndex] ?? '') : '';
  }

  let texts = messageCache.get(record.conversationId);
  if (!texts) {
    const { data } = await source.getMessages(record.conversationId, 0, MESSAGE_PAGE_SIZE, 'ASC');
    texts = new Map(data.map((message) => [message.id, messageText(message)]));
    messageCache.set(record.conversationId, texts);
  }
  const full = texts.get(sourceId);
  return full ? truncate(chunkText(full)[chunkIndex] ?? '') : '';
}

/**
 * Score stored vectors against a query vector and build the result page.
 *
 * Brute force over Float32Arrays: at desktop-history scale (tens of thousands of
 * chunks) this is a few milliseconds, and it needs no index to keep in sync.
 *
 * @param queryVector Embedding of the query text.
 * @param records Candidate rows, already narrowed by scope/conversation.
 * @param conversations Conversations used to label history hits.
 * @param source Repository used to re-read chunk text for the returned rows.
 */
export async function searchVectors({
  queryVector,
  records,
  conversations,
  source,
  limit = DEFAULT_QUERY_LIMIT,
}: {
  queryVector: Float32Array;
  records: readonly EmbeddingRecord[];
  conversations: readonly TChatConversation[];
  source: IndexerConversationSource;
  limit?: number;
}): Promise<SemanticSearchHit[]> {
  const comparable = records.filter((record) => record.vector.length === queryVector.length);
  const best = topK(comparable, limit, (record) => cosineSimilarity(queryVector, record.vector));
  const titles = new Map(conversations.map((conversation) => [conversation.id, conversation.name]));
  const messageCache = new Map<string, Map<string, string>>();

  const hits: SemanticSearchHit[] = [];
  for (const record of best) {
    const workspace = isWorkspaceConversationId(record.conversationId);
    const { sourceId } = parseRowId(record.messageId);
    hits.push({
      conversationId: record.conversationId,
      messageId: record.messageId,
      score: cosineSimilarity(queryVector, record.vector),
      snippet: await resolveSnippet(record, source, messageCache),
      conversationTitle: workspace ? sourceId.replace(/^file:/, '') : (titles.get(record.conversationId) ?? ''),
    });
  }
  return hits;
}

/**
 * In-memory cache of the stored vectors.
 *
 * Loading every row on each keystroke would dominate query time, so rows are
 * read once and dropped whenever the index is written to.
 */
export class VectorCache {
  private records: EmbeddingRecord[] | null = null;

  constructor(private readonly load: () => EmbeddingRecord[]) {}

  /** Cached rows, loading them on first use. */
  get(): EmbeddingRecord[] {
    if (!this.records) this.records = this.load();
    return this.records;
  }

  /** Drop the cache after an index write. */
  invalidate(): void {
    this.records = null;
  }
}
