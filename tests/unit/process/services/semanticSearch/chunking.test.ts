import { describe, expect, it } from 'vitest';
import {
  chunkRowId,
  chunkText,
  fileChunkRowId,
  workspaceConversationId,
} from '@process/services/semanticSearch/chunking';

describe('chunkText', () => {
  it('returns no chunks for blank text', () => {
    expect(chunkText('   \n\t ')).toEqual([]);
  });

  it('returns a single normalized chunk for short text', () => {
    expect(chunkText('  hello   world \n again ')).toEqual(['hello world again']);
  });

  it('splits long text into 800-character chunks overlapping by 100', () => {
    const text = 'a'.repeat(2000);
    const chunks = chunkText(text);

    expect(chunks[0]).toHaveLength(800);
    expect(chunks.length).toBeGreaterThan(2);
    // step = size - overlap = 700, so chunk N starts 700 characters after chunk N-1.
    expect(chunks.slice(0, -1).every((chunk) => chunk.length === 800)).toBe(true);
    expect(chunks.reduce((total, chunk) => total + chunk.length, 0)).toBeGreaterThan(text.length);
  });

  it('repeats the overlap region between neighbouring chunks', () => {
    const text = Array.from({ length: 2000 }, (_value, index) => String(index % 10)).join('');
    const [first, second] = chunkText(text);
    expect(second.slice(0, 100)).toBe(first.slice(700));
  });

  it('does not emit a trailing chunk once the tail is covered', () => {
    const chunks = chunkText('b'.repeat(1500));
    expect(chunks).toHaveLength(2);
  });

  it('rejects an overlap that is not smaller than the chunk size', () => {
    expect(() => chunkText('a'.repeat(50), 10, 10)).toThrow(/overlap/);
  });
});

describe('row ids', () => {
  it('builds message, file and workspace ids', () => {
    expect(chunkRowId('msg-1', 2)).toBe('msg-1#2');
    expect(fileChunkRowId('src/a.ts', 0)).toBe('file:src/a.ts#0');
    expect(workspaceConversationId('/tmp/ws')).toBe('workspace:/tmp/ws');
  });
});
