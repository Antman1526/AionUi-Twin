import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { EmbeddingRecord } from '@process/services/semanticSearch/SemanticSearchRepository';
import {
  filterByScope,
  isWorkspaceConversationId,
  parseRowId,
  searchVectors,
  VectorCache,
  workspacePathFromConversationId,
} from '@process/services/semanticSearch/SemanticSearchService';

const record = (messageId: string, conversationId: string, vector: number[]): EmbeddingRecord => ({
  messageId,
  conversationId,
  model: 'embedding',
  dims: vector.length,
  vector: Float32Array.from(vector),
  updatedAt: 1,
});

const conversations = [
  { id: 'c1', name: 'Deploy notes' },
  { id: 'c2', name: 'Grocery list' },
] as unknown as TChatConversation[];

const message = (id: string, content: string): TMessage =>
  ({ id, conversation_id: 'c1', type: 'text', content: { content } }) as unknown as TMessage;

const source = {
  listAllConversations: async () => conversations,
  getMessages: async (id: string) => ({
    data:
      id === 'c1'
        ? [message('m1', 'how to deploy the service'), message('m2', 'rollback plan')]
        : [message('m3', 'buy milk')],
    total: 2,
    hasMore: false,
  }),
};

describe('row id helpers', () => {
  it('splits a row id into source id and chunk index', () => {
    expect(parseRowId('m1#3')).toEqual({ sourceId: 'm1', chunkIndex: 3 });
    expect(parseRowId('file:src/a.ts#0')).toEqual({ sourceId: 'file:src/a.ts', chunkIndex: 0 });
    expect(parseRowId('m1')).toEqual({ sourceId: 'm1', chunkIndex: 0 });
  });

  it('recognises workspace conversation ids', () => {
    expect(isWorkspaceConversationId('workspace:/tmp/ws')).toBe(true);
    expect(isWorkspaceConversationId('c1')).toBe(false);
    expect(workspacePathFromConversationId('workspace:/tmp/ws')).toBe('/tmp/ws');
  });
});

describe('filterByScope', () => {
  const records = [record('m1#0', 'c1', [1]), record('file:a.md#0', 'workspace:/tmp/ws', [1])];

  it('narrows to history, workspace, or keeps everything', () => {
    expect(filterByScope(records, 'history').map((row) => row.messageId)).toEqual(['m1#0']);
    expect(filterByScope(records, 'workspace').map((row) => row.messageId)).toEqual(['file:a.md#0']);
    expect(filterByScope(records, 'all')).toHaveLength(2);
  });
});

describe('searchVectors', () => {
  it('returns the closest rows first with snippet and conversation title', async () => {
    const hits = await searchVectors({
      queryVector: Float32Array.from([1, 0]),
      records: [record('m3#0', 'c2', [0, 1]), record('m1#0', 'c1', [1, 0]), record('m2#0', 'c1', [0.7, 0.7])],
      conversations,
      source,
      limit: 2,
    });

    expect(hits.map((hit) => hit.messageId)).toEqual(['m1#0', 'm2#0']);
    expect(hits[0]).toMatchObject({
      conversationId: 'c1',
      conversationTitle: 'Deploy notes',
      snippet: 'how to deploy the service',
    });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('honours the limit', async () => {
    const hits = await searchVectors({
      queryVector: Float32Array.from([1, 0]),
      records: [record('m1#0', 'c1', [1, 0]), record('m2#0', 'c1', [0.9, 0.1])],
      conversations,
      source,
      limit: 1,
    });

    expect(hits).toHaveLength(1);
  });

  it('ignores rows whose width does not match the query vector', async () => {
    const hits = await searchVectors({
      queryVector: Float32Array.from([1, 0]),
      records: [record('m1#0', 'c1', [1, 0, 0])],
      conversations,
      source,
    });

    expect(hits).toEqual([]);
  });

  it('labels workspace hits with their relative path', async () => {
    const hits = await searchVectors({
      queryVector: Float32Array.from([1, 0]),
      records: [record('file:docs/readme.md#0', 'workspace:/nonexistent-workspace', [1, 0])],
      conversations,
      source,
    });

    expect(hits[0].conversationTitle).toBe('docs/readme.md');
    // The file is gone, so the snippet resolves to empty rather than throwing.
    expect(hits[0].snippet).toBe('');
  });
});

describe('VectorCache', () => {
  it('loads once and reloads after invalidation', () => {
    let calls = 0;
    const cache = new VectorCache(() => {
      calls += 1;
      return [record('m1#0', 'c1', [1])];
    });

    cache.get();
    cache.get();
    expect(calls).toBe(1);

    cache.invalidate();
    cache.get();
    expect(calls).toBe(2);
  });
});
