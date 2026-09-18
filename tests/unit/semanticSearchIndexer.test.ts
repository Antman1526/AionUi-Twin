/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingRow } from '@process/services/semanticSearch/EmbeddingStore';
import {
  EMBED_BATCH_SIZE,
  indexConversations,
  indexWorkspace,
  type CancellationSignal,
  type Embedder,
  type IndexProgress,
} from '@process/services/semanticSearch/SemanticIndexer';
import { queryIndex } from '@process/services/semanticSearch/SemanticQuery';
import { workspaceConversationId } from '@process/services/semanticSearch/workspaceGuard';

/** In-memory stand-in for EmbeddingStore with the surfaces the indexer uses. */
class FakeStore {
  rows = new Map<string, EmbeddingRow>();

  getFreshness(conversationId: string, model: string): Map<string, number> {
    const result = new Map<string, number>();
    for (const row of this.rows.values()) {
      if (row.conversationId === conversationId && row.model === model) {
        result.set(row.rowId, row.updatedAt);
      }
    }
    return result;
  }

  upsert(rows: readonly EmbeddingRow[]): void {
    for (const row of rows) this.rows.set(row.rowId, row);
  }

  load(conversationId?: string): EmbeddingRow[] {
    const all = [...this.rows.values()];
    return conversationId === undefined ? all : all.filter((row) => row.conversationId === conversationId);
  }
}

/** Deterministic embedder: the vector is a bag-of-marker-characters count. */
function makeEmbedder(model = 'fake-embed'): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model,
    calls,
    embed: async (inputs: string[]) => {
      calls.push(inputs);
      return inputs.map((input) => {
        const lower = input.toLowerCase();
        return [(lower.match(/a/g) ?? []).length, (lower.match(/b/g) ?? []).length, (lower.match(/c/g) ?? []).length];
      });
    },
  };
}

describe('indexConversations', () => {
  it('embeds each text message, reports progress and skips rows that are already up to date', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const progress: IndexProgress[] = [];

    const source = {
      listConversations: async () => [
        { id: 'conv-1', title: 'Alpha' },
        { id: 'conv-2', title: 'Beta' },
      ],
      listMessages: async (conversationId: string) =>
        conversationId === 'conv-1'
          ? [{ id: 'm1', createdAt: 100, text: 'aaa' }]
          : [{ id: 'm2', createdAt: 200, text: 'bbb' }],
    };

    const first = await indexConversations({ source, embedder, store, onProgress: (p) => progress.push(p) });

    expect(first).toEqual({ indexed: 2, skipped: 0, cancelled: false });
    expect(store.rows.get('m1#0')?.conversationId).toBe('conv-1');
    expect(store.rows.get('m1#0')?.dims).toBe(3);
    expect(progress.map((p) => p.phase)).toEqual(['conversations', 'conversations', 'done']);
    expect(progress[0]).toMatchObject({ processed: 0, total: 2, label: 'Alpha' });
    expect(progress.at(-1)).toMatchObject({ processed: 2, total: 2 });

    // Second pass: nothing changed, so every chunk is skipped and no request is made.
    const callsBefore = embedder.calls.length;
    const second = await indexConversations({ source, embedder, store });
    expect(second).toEqual({ indexed: 0, skipped: 2, cancelled: false });
    expect(embedder.calls.length).toBe(callsBefore);
  });

  it('re-embeds a message that changed after it was indexed', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const source = {
      listConversations: async () => [{ id: 'conv-1', title: 'Alpha' }],
      listMessages: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'm1', createdAt: 100, text: 'aaa' }])
        .mockResolvedValueOnce([{ id: 'm1', createdAt: 500, text: 'bbbb' }]),
    };

    await indexConversations({ source, embedder, store });
    const second = await indexConversations({ source, embedder, store });

    expect(second.indexed).toBe(1);
    expect(store.rows.get('m1#0')?.updatedAt).toBe(500);
  });

  it('re-embeds everything when the embedding model changes', async () => {
    const store = new FakeStore();
    const source = {
      listConversations: async () => [{ id: 'conv-1', title: 'Alpha' }],
      listMessages: async () => [{ id: 'm1', createdAt: 100, text: 'aaa' }],
    };

    await indexConversations({ source, embedder: makeEmbedder('model-a'), store });
    const second = await indexConversations({ source, embedder: makeEmbedder('model-b'), store });

    expect(second).toEqual({ indexed: 1, skipped: 0, cancelled: false });
    expect(store.rows.get('m1#0')?.model).toBe('model-b');
  });

  it('stops at the next conversation once cancelled', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const signal: CancellationSignal = { aborted: false };

    const result = await indexConversations({
      source: {
        listConversations: async () => [
          { id: 'conv-1', title: 'Alpha' },
          { id: 'conv-2', title: 'Beta' },
        ],
        listMessages: async (conversationId: string) => {
          if (conversationId === 'conv-1') signal.aborted = true;
          return [{ id: `${conversationId}-m`, createdAt: 1, text: 'aaa' }];
        },
      },
      embedder,
      store,
      signal,
    });

    expect(result.cancelled).toBe(true);
    expect(store.rows.has('conv-2-m#0')).toBe(false);
  });

  it('batches long conversations into requests of at most EMBED_BATCH_SIZE inputs', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const messages = Array.from({ length: EMBED_BATCH_SIZE + 3 }, (_unused, index) => ({
      id: `m${index}`,
      createdAt: 1,
      text: 'aaa',
    }));

    await indexConversations({
      source: {
        listConversations: async () => [{ id: 'conv-1', title: 'Alpha' }],
        listMessages: async () => messages,
      },
      embedder,
      store,
    });

    expect(embedder.calls.map((batch) => batch.length)).toEqual([EMBED_BATCH_SIZE, 3]);
  });
});

describe('indexWorkspace', () => {
  it('keys rows under the workspace id and skips unreadable files', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const progress: IndexProgress[] = [];

    const result = await indexWorkspace({
      workspacePath: '/tmp/ws/',
      files: ['README.md', 'logo.png'],
      readFile: async (relativePath) => (relativePath === 'README.md' ? { text: 'aab', modifiedAt: 1_000 } : null),
      embedder,
      store,
      onProgress: (p) => progress.push(p),
    });

    expect(result).toEqual({ indexed: 1, skipped: 1, cancelled: false });
    const row = store.rows.get('file:README.md#0');
    expect(row?.conversationId).toBe(workspaceConversationId('/tmp/ws'));
    expect(progress.map((p) => p.phase)).toEqual(['workspace', 'workspace', 'done']);
  });

  it('skips a file whose stored rows are newer than its mtime', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const options = {
      workspacePath: '/tmp/ws',
      files: ['a.md'],
      readFile: async () => ({ text: 'abc', modifiedAt: 1_000 }),
      embedder,
      store,
    };

    await indexWorkspace(options);
    const second = await indexWorkspace(options);

    expect(second).toEqual({ indexed: 0, skipped: 1, cancelled: false });
  });
});

describe('queryIndex', () => {
  it('returns top-k hits ordered by similarity, with snippets and titles', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();

    await indexConversations({
      source: {
        listConversations: async () => [
          { id: 'conv-1', title: 'Alpha' },
          { id: 'conv-2', title: 'Beta' },
          { id: 'conv-3', title: 'Gamma' },
        ],
        listMessages: async (conversationId: string) =>
          ({
            'conv-1': [{ id: 'm1', createdAt: 1, text: 'aaaa' }],
            'conv-2': [{ id: 'm2', createdAt: 1, text: 'bbbb' }],
            'conv-3': [{ id: 'm3', createdAt: 1, text: 'aaab' }],
          })[conversationId] ?? [],
      },
      embedder,
      store,
    });

    const titles: Record<string, string> = { 'conv-1': 'Alpha', 'conv-2': 'Beta', 'conv-3': 'Gamma' };
    const hits = await queryIndex({
      text: 'aaaa',
      limit: 2,
      embedder,
      store,
      resolveSnippet: async (row) => `snippet:${row.rowId}`,
      resolveTitle: (conversationId) => titles[conversationId] ?? '',
    });

    expect(hits).toHaveLength(2);
    expect(hits[0].conversationId).toBe('conv-1');
    expect(hits[0].messageId).toBe('m1');
    expect(hits[0].conversationTitle).toBe('Alpha');
    expect(hits[0].snippet).toBe('snippet:m1#0');
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    expect(hits[1].conversationId).toBe('conv-3');
  });

  it('excludes workspace rows from the conversations scope', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();

    await indexWorkspace({
      workspacePath: '/tmp/ws',
      files: ['a.md'],
      readFile: async () => ({ text: 'aaaa', modifiedAt: 1 }),
      embedder,
      store,
    });

    const conversationHits = await queryIndex({
      text: 'aaaa',
      limit: 5,
      scope: { kind: 'conversations' },
      embedder,
      store,
      resolveSnippet: async () => 'x',
      resolveTitle: () => '',
    });
    expect(conversationHits).toEqual([]);

    const workspaceHits = await queryIndex({
      text: 'aaaa',
      limit: 5,
      scope: { kind: 'workspace', workspacePath: '/tmp/ws' },
      embedder,
      store,
      resolveSnippet: async () => 'x',
      resolveTitle: () => '',
    });
    expect(workspaceHits).toHaveLength(1);
  });

  it('returns nothing for blank input or an empty index', async () => {
    const store = new FakeStore();
    const embedder = makeEmbedder();
    const common = {
      embedder,
      store,
      resolveSnippet: async () => '',
      resolveTitle: () => '',
    };

    await expect(queryIndex({ text: '   ', limit: 5, ...common })).resolves.toEqual([]);
    await expect(queryIndex({ text: 'aaa', limit: 5, ...common })).resolves.toEqual([]);
  });
});
