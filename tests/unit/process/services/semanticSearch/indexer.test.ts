import { describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { indexConversations, messageText } from '@process/services/semanticSearch/Indexer';
import type { EmbeddingRowInput } from '@process/services/semanticSearch/SemanticSearchRepository';
import type { SemanticIndexProgress } from '@process/services/semanticSearch/types';

const conversation = (id: string): TChatConversation =>
  ({ id, name: `conv ${id}`, type: 'gemini', createTime: 1, modifyTime: 1, extra: {} }) as unknown as TChatConversation;

const textMessage = (id: string, content: string, createdAt = 1_000): TMessage =>
  ({ id, conversation_id: 'c1', type: 'text', content: { content }, createdAt }) as unknown as TMessage;

function createFakes(stored: Record<string, number> = {}) {
  const written: EmbeddingRowInput[] = [];
  const store = {
    getUpdatedAtMap: (_conversationId: string) => new Map(Object.entries(stored)),
    upsertMany: (rows: readonly EmbeddingRowInput[]) => written.push(...rows),
  };
  const embed = vi.fn(async (inputs: string[]) => inputs.map((_input, index) => [index, 1]));
  const progress: SemanticIndexProgress[] = [];
  return { written, store, embed, progress, onProgress: (event: SemanticIndexProgress) => progress.push(event) };
}

describe('messageText', () => {
  it('reads plain string content and ignores structured payloads', () => {
    expect(messageText(textMessage('m1', '  hi  '))).toBe('hi');
    expect(messageText({ id: 'm2', content: { content: { tool: 'x' } } } as unknown as TMessage)).toBe('');
  });
});

describe('indexConversations', () => {
  const source = {
    listAllConversations: async () => [conversation('c1')],
    getMessages: async () => ({
      data: [textMessage('m1', 'alpha'), textMessage('m2', 'beta'), { id: 'm3', content: {} } as unknown as TMessage],
      total: 3,
      hasMore: false,
    }),
  };

  it('embeds every text message and writes one row per chunk', async () => {
    const fakes = createFakes();

    const result = await indexConversations(source, {
      store: fakes.store,
      embed: fakes.embed,
      model: 'embedding',
      onProgress: fakes.onProgress,
      now: () => 5_000,
    });

    expect(result).toEqual({ indexed: 2, total: 2, cancelled: false });
    expect(fakes.embed).toHaveBeenCalledWith(['alpha', 'beta']);
    expect(fakes.written.map((row) => row.messageId)).toEqual(['m1#0', 'm2#0']);
    expect(fakes.written[0]).toMatchObject({ conversationId: 'c1', model: 'embedding', updatedAt: 5_000 });
  });

  it('skips rows whose stored updated_at is not older than the message', async () => {
    const fakes = createFakes({ 'm1#0': 2_000 });

    const result = await indexConversations(source, {
      store: fakes.store,
      embed: fakes.embed,
      model: 'embedding',
      onProgress: fakes.onProgress,
    });

    expect(fakes.embed).toHaveBeenCalledWith(['beta']);
    expect(fakes.written.map((row) => row.messageId)).toEqual(['m2#0']);
    expect(result.total).toBe(2);
    expect(result.indexed).toBe(2);
  });

  it('re-embeds a row whose stored vector is older than the message', async () => {
    const fakes = createFakes({ 'm1#0': 10, 'm2#0': 10 });

    await indexConversations(source, { store: fakes.store, embed: fakes.embed, model: 'embedding' });

    expect(fakes.embed).toHaveBeenCalledWith(['alpha', 'beta']);
  });

  it('reports progress ending in the done state', async () => {
    const fakes = createFakes();

    await indexConversations(source, {
      store: fakes.store,
      embed: fakes.embed,
      model: 'embedding',
      onProgress: fakes.onProgress,
    });

    expect(fakes.progress[0]).toEqual({ indexed: 0, total: 2, state: 'running' });
    expect(fakes.progress.at(-1)).toEqual({ indexed: 2, total: 2, state: 'done' });
  });

  it('stops at the next batch boundary when cancelled', async () => {
    const fakes = createFakes();

    const result = await indexConversations(source, {
      store: fakes.store,
      embed: fakes.embed,
      model: 'embedding',
      onProgress: fakes.onProgress,
      shouldCancel: () => true,
    });

    expect(result.cancelled).toBe(true);
    expect(fakes.embed).not.toHaveBeenCalled();
    expect(fakes.progress.at(-1)?.state).toBe('cancelled');
  });
});
