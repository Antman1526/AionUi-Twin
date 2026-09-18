/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SemanticSearchHit, SemanticSearchScope } from '@/common/adapter/ipcBridge';
import { parseRowId } from './chunking';
import type { EmbeddingRow } from './EmbeddingStore';
import type { Embedder } from './SemanticIndexer';
import { cosineSimilarity, topK } from './vectorMath';
import { isWorkspaceConversationId, workspaceConversationId } from './workspaceGuard';

/** Read surface the query path needs, so tests can supply rows directly. */
export type QueryReadableStore = {
  load(conversationId?: string): EmbeddingRow[];
};

/** Resolve the original chunk text for a hit, used to build its snippet. */
export type SnippetResolver = (row: { rowId: string; conversationId: string }) => Promise<string>;

function matchesScope(conversationId: string, scope: SemanticSearchScope): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'conversations':
      return !isWorkspaceConversationId(conversationId);
    case 'conversation':
      return conversationId === scope.conversationId;
    case 'workspace':
      return conversationId === workspaceConversationId(scope.workspacePath);
  }
}

/**
 * Embed `text`, score every candidate vector by cosine similarity and return the
 * best `limit` hits with their snippets.
 *
 * Brute force over Float32Arrays is intentional: the index is a few thousand
 * rows at most, and an ANN structure would be more invalidation surface than
 * it saves.
 */
export async function queryIndex({
  text,
  limit,
  scope = { kind: 'all' },
  embedder,
  store,
  resolveSnippet,
  resolveTitle,
}: {
  text: string;
  limit: number;
  scope?: SemanticSearchScope;
  embedder: Embedder;
  store: QueryReadableStore;
  resolveSnippet: SnippetResolver;
  resolveTitle: (conversationId: string) => string;
}): Promise<SemanticSearchHit[]> {
  const trimmed = text.trim();
  if (!trimmed || limit <= 0) return [];

  const candidates = (scope.kind === 'conversation' ? store.load(scope.conversationId) : store.load()).filter(
    (row) => row.model === embedder.model && matchesScope(row.conversationId, scope)
  );
  if (candidates.length === 0) return [];

  const [queryVector] = await embedder.embed([trimmed]);
  if (!queryVector || queryVector.length === 0) return [];
  const query = Float32Array.from(queryVector);

  const scored = candidates.map((row) => ({ row, score: cosineSimilarity(query, row.vector) }));

  const hits: SemanticSearchHit[] = [];
  for (const { row, score } of topK(scored, limit)) {
    const parsed = parseRowId(row.rowId);
    hits.push({
      conversationId: row.conversationId,
      messageId: parsed?.key ?? row.rowId,
      score,
      snippet: await resolveSnippet({ rowId: row.rowId, conversationId: row.conversationId }),
      conversationTitle: resolveTitle(row.conversationId),
    });
  }
  return hits;
}
