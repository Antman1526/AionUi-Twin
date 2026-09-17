import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearGgufMetadataCache,
  parseGgufHeader,
  quantizationFromFileName,
  quantizationLabel,
  readGgufMetadata,
} from '@process/services/localModels/ggufMetadata';

type KvValue =
  | { type: 'string'; value: string }
  | { type: 'u32'; value: number }
  | { type: 'u64'; value: number }
  | { type: 'f32'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'array-u32'; value: number[] }
  | { type: 'array-string'; value: string[] };

const TYPE_IDS = { u32: 4, f32: 6, bool: 7, string: 8, array: 9, u64: 10 } as const;

function lengthBuffer(version: number, value: number): Buffer {
  if (version >= 3) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value));
    return buf;
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

function stringBuffer(version: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf-8');
  return Buffer.concat([lengthBuffer(version, bytes.length), bytes]);
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

function valueBuffer(version: number, entry: KvValue): Buffer {
  switch (entry.type) {
    case 'string':
      return Buffer.concat([u32(TYPE_IDS.string), stringBuffer(version, entry.value)]);
    case 'u32': {
      return Buffer.concat([u32(TYPE_IDS.u32), u32(entry.value)]);
    }
    case 'u64': {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(entry.value));
      return Buffer.concat([u32(TYPE_IDS.u64), buf]);
    }
    case 'f32': {
      const buf = Buffer.alloc(4);
      buf.writeFloatLE(entry.value);
      return Buffer.concat([u32(TYPE_IDS.f32), buf]);
    }
    case 'bool':
      return Buffer.concat([u32(TYPE_IDS.bool), Buffer.from([entry.value ? 1 : 0])]);
    case 'array-u32':
      return Buffer.concat([
        u32(TYPE_IDS.array),
        u32(TYPE_IDS.u32),
        lengthBuffer(version, entry.value.length),
        ...entry.value.map(u32),
      ]);
    case 'array-string':
      return Buffer.concat([
        u32(TYPE_IDS.array),
        u32(TYPE_IDS.string),
        lengthBuffer(version, entry.value.length),
        ...entry.value.map((item) => stringBuffer(version, item)),
      ]);
  }
}

function buildGguf(version: number, kv: Array<[string, KvValue]>): Buffer {
  const parts: Buffer[] = [
    Buffer.from('GGUF', 'ascii'),
    u32(version),
    lengthBuffer(version, 0), // tensor_count
    lengthBuffer(version, kv.length),
  ];
  for (const [key, entry] of kv) {
    parts.push(stringBuffer(version, key), valueBuffer(version, entry));
  }
  return Buffer.concat(parts);
}

const LLAMA_KV: Array<[string, KvValue]> = [
  ['general.architecture', { type: 'string', value: 'llama' }],
  ['general.name', { type: 'string', value: 'Test Llama' }],
  ['general.file_type', { type: 'u32', value: 15 }],
  ['general.size_label', { type: 'string', value: '7B' }],
  ['general.quantization_version', { type: 'u32', value: 2 }],
  ['llama.context_length', { type: 'u32', value: 131072 }],
  ['llama.block_count', { type: 'u32', value: 28 }],
  ['llama.embedding_length', { type: 'u64', value: 3584 }],
  ['llama.attention.head_count', { type: 'u32', value: 28 }],
  ['llama.attention.head_count_kv', { type: 'u32', value: 4 }],
  ['llama.rope.freq_base', { type: 'f32', value: 1000000 }],
  ['llama.attention.causal', { type: 'bool', value: true }],
  ['llama.extra.ids', { type: 'array-u32', value: [1, 2, 3, 4] }],
];

describe('parseGgufHeader', () => {
  it('reads a v3 header containing string, u32, u64, f32, bool and array values', () => {
    const metadata = parseGgufHeader(buildGguf(3, LLAMA_KV));

    expect(metadata).toEqual({
      version: 3,
      architecture: 'llama',
      name: 'Test Llama',
      quantization: 'Q4_K_M',
      sizeLabel: '7B',
      contextLength: 131072,
      blockCount: 28,
      embeddingLength: 3584,
      headCount: 28,
      headCountKv: 4,
    });
  });

  it('reads a v2 header, where counts and lengths are u32', () => {
    const metadata = parseGgufHeader(
      buildGguf(2, [
        ['general.architecture', { type: 'string', value: 'qwen2' }],
        ['general.file_type', { type: 'u32', value: 18 }],
        ['qwen2.context_length', { type: 'u32', value: 32768 }],
        ['qwen2.block_count', { type: 'u32', value: 24 }],
      ])
    );

    expect(metadata).toMatchObject({
      version: 2,
      architecture: 'qwen2',
      quantization: 'Q6_K',
      contextLength: 32768,
      blockCount: 24,
    });
  });

  it('stops before the tokenizer section so huge vocab arrays are never read', () => {
    const buffer = buildGguf(3, [
      ['general.architecture', { type: 'string', value: 'llama' }],
      ['tokenizer.ggml.tokens', { type: 'array-string', value: ['a', 'b'] }],
      ['llama.block_count', { type: 'u32', value: 40 }],
    ]);

    const metadata = parseGgufHeader(buffer);
    expect(metadata.architecture).toBe('llama');
    expect(metadata.blockCount).toBeUndefined();
  });

  it('rejects a buffer that is not GGUF', () => {
    const buffer = Buffer.concat([Buffer.from('NOPE', 'ascii'), u32(3), Buffer.alloc(16)]);
    expect(() => parseGgufHeader(buffer)).toThrow('magic bytes mismatch');
  });

  it('rejects an unsupported container version', () => {
    expect(() => parseGgufHeader(buildGguf(1, []))).toThrow('Unsupported GGUF version 1');
  });

  it('reports a truncated header instead of returning partial data', () => {
    const full = buildGguf(3, LLAMA_KV);
    expect(() => parseGgufHeader(full.subarray(0, full.length - 10))).toThrow('GGUF header is truncated');
  });
});

describe('quantizationLabel', () => {
  it('maps known file_type values', () => {
    expect(quantizationLabel(0)).toBe('F32');
    expect(quantizationLabel(1)).toBe('F16');
    expect(quantizationLabel(15)).toBe('Q4_K_M');
    expect(quantizationLabel(18)).toBe('Q6_K');
    expect(quantizationLabel(32)).toBe('BF16');
  });

  it('falls back to UNKNOWN(n) for unmapped values', () => {
    expect(quantizationLabel(99)).toBe('UNKNOWN(99)');
    expect(quantizationLabel(4)).toBe('UNKNOWN(4)');
  });
});

describe('quantizationFromFileName', () => {
  it('extracts the quant label from common GGUF file names', () => {
    expect(quantizationFromFileName('/models/Qwen3-4B-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(quantizationFromFileName('gemma-3-4b-it-q8_0.gguf')).toBe('Q8_0');
    expect(quantizationFromFileName('model-IQ3_XXS.gguf')).toBe('IQ3_XXS');
    expect(quantizationFromFileName('model-BF16.gguf')).toBe('BF16');
  });

  it('returns undefined when no quant marker is present', () => {
    expect(quantizationFromFileName('mystery-model.gguf')).toBeUndefined();
  });
});

describe('readGgufMetadata', () => {
  let dir: string;

  beforeEach(async () => {
    clearGgufMetadataCache();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gguf-metadata-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads a header from disk without loading the whole file', async () => {
    const filePath = path.join(dir, 'Test-Q4_K_M.gguf');
    // Header followed by a large "tensor" body that must not be read.
    await fs.writeFile(filePath, Buffer.concat([buildGguf(3, LLAMA_KV), Buffer.alloc(2 * 1024 * 1024, 7)]));

    const metadata = await readGgufMetadata(filePath);
    expect(metadata.architecture).toBe('llama');
    expect(metadata.quantization).toBe('Q4_K_M');
    expect(metadata.headCountKv).toBe(4);
  });

  it('falls back to the filename quant label when general.file_type is absent', async () => {
    const filePath = path.join(dir, 'nameless-Q5_K_M.gguf');
    await fs.writeFile(
      filePath,
      buildGguf(3, [
        ['general.architecture', { type: 'string', value: 'llama' }],
        ['llama.block_count', { type: 'u32', value: 32 }],
      ])
    );

    const metadata = await readGgufMetadata(filePath);
    expect(metadata.quantization).toBe('Q5_K_M');
  });

  it('returns the cached result for an unchanged file', async () => {
    const filePath = path.join(dir, 'cached-Q4_K_M.gguf');
    await fs.writeFile(filePath, buildGguf(3, LLAMA_KV));

    const first = await readGgufMetadata(filePath);
    const second = await readGgufMetadata(filePath);
    expect(second).toBe(first);
  });

  it('rejects a truncated file on disk', async () => {
    const filePath = path.join(dir, 'broken.gguf');
    const full = buildGguf(3, LLAMA_KV);
    await fs.writeFile(filePath, full.subarray(0, 40));

    await expect(readGgufMetadata(filePath)).rejects.toThrow('GGUF header is truncated');
  });
});
