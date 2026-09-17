/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Which corpus a semantic query searches. */
export type SemanticSearchScope = 'history' | 'workspace' | 'all';

/** One scored match returned by a semantic query. */
export type SemanticSearchHit = {
  /** Conversation id, or `workspace:<path>` for indexed files. */
  conversationId: string;
  /** Row id: `<messageId>#<chunk>` for history, `file:<relativePath>#<chunk>` for files. */
  messageId: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  score: number;
  /** Plain-text excerpt of the matched chunk. */
  snippet: string;
  /** Conversation name, or the relative file path for workspace hits. */
  conversationTitle: string;
};

/** Lifecycle state reported while an index run is in flight. */
export type SemanticIndexState = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

/** Progress event emitted over `semanticSearch.indexProgress`. */
export type SemanticIndexProgress = {
  indexed: number;
  total: number;
  state: SemanticIndexState;
  /** Failure detail when `state` is `error`. */
  message?: string;
};

/** Aggregate counters describing the stored index. */
export type SemanticIndexStats = {
  rows: number;
  conversations: number;
  lastIndexedAt: number | null;
  model: string | null;
  dimensions: number | null;
};

/** Persisted semantic-search configuration, as surfaced to the renderer. */
export type SemanticSearchSettings = {
  enabled: boolean;
  embeddingModelPath?: string;
  providerId?: string;
  dimensions?: number;
};

/** Request payload for `semanticSearch.query`. */
export type SemanticSearchQueryRequest = {
  text: string;
  limit?: number;
  conversationId?: string;
  scope?: SemanticSearchScope;
};
