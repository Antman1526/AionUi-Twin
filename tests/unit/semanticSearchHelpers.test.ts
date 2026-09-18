/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { chunkText, fileRowId, messageRowId, parseRowId } from '@process/services/semanticSearch/chunking';
import {
  cosineSimilarity,
  deserializeVector,
  serializeVector,
  topK,
} from '@process/services/semanticSearch/vectorMath';
import { isKnownWorkspace, workspaceConversationId } from '@process/services/semanticSearch/workspaceGuard';
import { isIndexableFileName, looksBinary } from '@process/services/semanticSearch/workspaceFiles';
import { buildEmbeddingServerArgs, isLoopbackBaseUrl } from '@process/services/semanticSearch/EmbeddingRuntime';

describe('chunkText', () => {
  it('returns a single chunk for text shorter than the window', () => {
    expect(chunkText('hello world', { chunkSize: 800, overlap: 100 })).toEqual(['hello world']);
  });

  it('returns nothing for blank text', () => {
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('overlaps consecutive chunks by the requested amount', () => {
    const text = 'abcdefghij'.repeat(3); // 30 chars
    const chunks = chunkText(text, { chunkSize: 10, overlap: 4 });

    // step = 6 → windows at 0, 6, 12, 18, 24
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toBe(text.slice(0, 10));
    expect(chunks[1]).toBe(text.slice(6, 16));
    // The tail of one chunk is the head of the next.
    expect(chunks[0].slice(-4)).toBe(chunks[1].slice(0, 4));
    expect(chunks.at(-1)).toBe(text.slice(24, 30));
  });

  it('clamps an overlap that would stall the window', () => {
    const chunks = chunkText('abcdefgh', { chunkSize: 4, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(10);
  });

  it('round-trips row ids for messages and files', () => {
    expect(parseRowId(messageRowId('msg-1', 3))).toEqual({ key: 'msg-1', chunkIndex: 3 });
    expect(parseRowId(fileRowId('src/a#b.ts', 2))).toEqual({ key: 'file:src/a#b.ts', chunkIndex: 2 });
    expect(parseRowId('no-separator')).toBeNull();
  });
});

describe('vector serialization', () => {
  it('round-trips a Float32 vector through the BLOB encoding', () => {
    const original = [0.5, -0.25, 1.5, 0];
    const restored = deserializeVector(serializeVector(original));

    expect(restored).toBeInstanceOf(Float32Array);
    expect(Array.from(restored)).toEqual(original);
  });

  it('rejects a blob that is not a whole number of floats', () => {
    expect(() => deserializeVector(new Uint8Array([1, 2, 3]))).toThrow(/not a multiple of 4/);
  });
});

describe('cosineSimilarity', () => {
  it('scores identical directions at 1 and opposite directions at -1', () => {
    const a = Float32Array.from([1, 0, 0]);
    expect(cosineSimilarity(a, Float32Array.from([2, 0, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(a, Float32Array.from([-1, 0, 0]))).toBeCloseTo(-1, 6);
    expect(cosineSimilarity(a, Float32Array.from([0, 1, 0]))).toBeCloseTo(0, 6);
  });

  it('scores 0 when dimensions differ or a vector is empty', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0]))).toBe(0);
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });
});

describe('topK', () => {
  it('orders best first and truncates to the limit', () => {
    const items = [{ score: 0.1 }, { score: 0.9 }, { score: 0.5 }, { score: -0.2 }];
    expect(topK(items, 2).map((item) => item.score)).toEqual([0.9, 0.5]);
    expect(topK(items, 0)).toEqual([]);
    expect(topK(items, 99)).toHaveLength(4);
  });
});

describe('isKnownWorkspace', () => {
  const conversations = [
    { extra: { workspace: '/Users/alice/projects/app' } },
    { extra: { workspace: '/Users/alice/notes' } },
    { extra: {} },
  ];

  it('accepts an exact match', () => {
    expect(isKnownWorkspace('/Users/alice/projects/app', conversations)).toBe(true);
  });

  it('accepts a trailing-slash variant of a known workspace', () => {
    expect(isKnownWorkspace('/Users/alice/notes/', conversations)).toBe(true);
  });

  it('rejects a path that escapes a known workspace via ..', () => {
    expect(isKnownWorkspace('/Users/alice/projects/app/../../secrets', conversations)).toBe(false);
    expect(isKnownWorkspace('/Users/alice/projects/app/..', conversations)).toBe(false);
  });

  it('rejects a trailing-slash variant of an unknown path', () => {
    expect(isKnownWorkspace('/Users/alice/projects/other/', conversations)).toBe(false);
  });

  it('rejects unrelated and relative paths', () => {
    expect(isKnownWorkspace('/etc', conversations)).toBe(false);
    expect(isKnownWorkspace('projects/app', conversations)).toBe(false);
    expect(isKnownWorkspace('', conversations)).toBe(false);
  });

  it('namespaces workspace rows away from conversation ids', () => {
    expect(workspaceConversationId('/Users/alice/notes/')).toBe('workspace:/Users/alice/notes');
  });
});

describe('workspace file filtering', () => {
  it('accepts supported text extensions and rejects everything else', () => {
    expect(isIndexableFileName('README.md')).toBe(true);
    expect(isIndexableFileName('main.RS')).toBe(true);
    expect(isIndexableFileName('image.png')).toBe(false);
    expect(isIndexableFileName('._notes.md')).toBe(false);
  });

  it('detects binary content by its NUL bytes', () => {
    expect(looksBinary(Buffer.from('plain text'))).toBe(false);
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x00, 0x03]))).toBe(true);
  });
});

describe('embedding runtime configuration', () => {
  it('only accepts loopback provider endpoints', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://example.com/v1')).toBe(false);
    expect(isLoopbackBaseUrl('not a url')).toBe(false);
  });

  it('builds llama-server args that restrict it to embeddings on loopback', () => {
    const args = buildEmbeddingServerArgs({
      modelPath: '/models/bge.gguf',
      port: 5051,
      alias: 'bge',
      contextSize: 512,
    });
    expect(args).toContain('--embedding');
    expect(args.join(' ')).toContain('--host 127.0.0.1');
    expect(args.join(' ')).toContain('--port 5051');
    expect(args.join(' ')).toContain('-m /models/bge.gguf');
  });
});
