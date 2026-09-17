/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Subset of GGUF key/value metadata the UI needs to describe a model.
 * Every field is optional: a model may omit any key, and parsing stops early
 * once the tokenizer section is reached (its arrays are hundreds of MB).
 */
export type GgufMetadata = {
  /** GGUF container version (2 or 3). */
  version: number;
  /** `general.architecture`, e.g. `llama`, `qwen3`, `gemma3`. */
  architecture?: string;
  /** `general.name` — the publisher's display name. */
  name?: string;
  /** Quantisation label derived from `general.file_type`, e.g. `Q4_K_M`. */
  quantization?: string;
  /** `general.size_label`, e.g. `4B`. */
  sizeLabel?: string;
  /** `<arch>.context_length` — the context the model was trained for. */
  contextLength?: number;
  /** `<arch>.block_count` — number of transformer layers. */
  blockCount?: number;
  /** `<arch>.embedding_length` — hidden size. */
  embeddingLength?: number;
  /** `<arch>.attention.head_count`. */
  headCount?: number;
  /** `<arch>.attention.head_count_kv` (grouped-query attention). */
  headCountKv?: number;
};

/** GGUF `general.file_type` enum → human-readable quantisation label. */
export const GGUF_FILE_TYPES: Record<number, string> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  7: 'Q8_0',
  8: 'Q5_0',
  9: 'Q5_1',
  10: 'Q2_K',
  11: 'Q3_K_S',
  12: 'Q3_K_M',
  13: 'Q3_K_L',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
  19: 'IQ2_XXS',
  20: 'IQ2_XS',
  21: 'Q2_K_S',
  22: 'IQ3_XS',
  23: 'IQ3_XXS',
  24: 'IQ1_S',
  25: 'IQ4_NL',
  26: 'IQ3_S',
  27: 'IQ3_M',
  28: 'IQ2_S',
  29: 'IQ2_M',
  30: 'IQ4_XS',
  31: 'IQ1_M',
  32: 'BF16',
};

/** Map a `general.file_type` value to its label, or `UNKNOWN(n)` when unrecognised. */
export function quantizationLabel(fileType: number): string {
  return GGUF_FILE_TYPES[fileType] ?? `UNKNOWN(${fileType})`;
}

const QUANT_FROM_FILENAME = /\b(IQ[1-4](?:_[A-Z]+)*|Q[2-8]_(?:K(?:_[SML])?|[01])|BF16|F16|F32)\b/i;

/**
 * Best-effort quantisation label from a GGUF filename, used when the header has
 * no `general.file_type` key (some community conversions omit it).
 */
export function quantizationFromFileName(fileName: string): string | undefined {
  const match = QUANT_FROM_FILENAME.exec(path.basename(fileName));
  return match ? match[1].toUpperCase() : undefined;
}

export class GgufParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GgufParseError';
  }
}

const MAGIC = 0x46554747; // "GGUF" little-endian
const INITIAL_READ_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024 * 1024;

/**
 * Sentinel thrown internally when the supplied buffer ends mid-structure but the
 * file itself may contain more; the streaming reader grows its window and retries.
 */
class NeedMoreBytes extends Error {}

type ValueType = number;

class Cursor {
  offset = 0;

  constructor(
    readonly buffer: Buffer,
    /** When true, running off the end is a hard error rather than a request for more bytes. */
    readonly complete: boolean
  ) {}

  private require(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) {
      if (this.complete) throw new GgufParseError('GGUF header is truncated');
      throw new NeedMoreBytes();
    }
  }

  u8(): number {
    this.require(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  i8(): number {
    this.require(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.require(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  i16(): number {
    this.require(2);
    const value = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    this.require(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  f32(): number {
    this.require(4);
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  f64(): number {
    this.require(8);
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  u64(): number {
    this.require(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return Number(value);
  }

  i64(): number {
    this.require(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return Number(value);
  }

  bytes(length: number): Buffer {
    this.require(length);
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  /** Advance without materialising the data (used to skip huge tokenizer arrays). */
  skip(length: number): void {
    this.require(length);
    this.offset += length;
  }
}

/** GGUF v2 uses u32 counts and lengths; v3 widened them to u64. */
function readLength(cursor: Cursor, version: number): number {
  return version >= 3 ? cursor.u64() : cursor.u32();
}

function readString(cursor: Cursor, version: number): string {
  const length = readLength(cursor, version);
  if (length < 0 || length > 64 * 1024 * 1024) throw new GgufParseError(`Implausible GGUF string length ${length}`);
  return cursor.bytes(length).toString('utf-8');
}

function readScalar(cursor: Cursor, type: ValueType, version: number): string | number | boolean {
  switch (type) {
    case 0:
      return cursor.u8();
    case 1:
      return cursor.i8();
    case 2:
      return cursor.u16();
    case 3:
      return cursor.i16();
    case 4:
      return cursor.u32();
    case 5:
      return cursor.i32();
    case 6:
      return cursor.f32();
    case 7:
      return cursor.u8() !== 0;
    case 8:
      return readString(cursor, version);
    case 10:
      return cursor.u64();
    case 11:
      return cursor.i64();
    case 12:
      return cursor.f64();
    default:
      throw new GgufParseError(`Unsupported GGUF value type ${type}`);
  }
}

const FIXED_WIDTH: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

/** Consume an array value, skipping its payload as cheaply as the element type allows. */
function skipArray(cursor: Cursor, version: number): void {
  const elementType = cursor.u32();
  const count = readLength(cursor, version);
  if (elementType === 9) throw new GgufParseError('Nested GGUF arrays are not supported');
  if (elementType === 8) {
    for (let index = 0; index < count; index += 1) {
      cursor.skip(readLength(cursor, version));
    }
    return;
  }
  const width = FIXED_WIDTH[elementType];
  if (width === undefined) throw new GgufParseError(`Unsupported GGUF array element type ${elementType}`);
  cursor.skip(width * count);
}

function toInteger(value: string | number | boolean | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/**
 * Parse a GGUF header out of an in-memory buffer.
 *
 * Supports container versions 2 and 3, little-endian only. Parsing stops at the
 * first `tokenizer.*` key (those arrays dominate the header and are never needed
 * here) or once every wanted key has been seen. Throws {@link GgufParseError}
 * when the magic/version are wrong or the buffer ends mid-structure.
 */
export function parseGgufHeader(buffer: Buffer): GgufMetadata {
  return parseHeaderInternal(buffer, true);
}

function parseHeaderInternal(buffer: Buffer, complete: boolean): GgufMetadata {
  const cursor = new Cursor(buffer, complete);
  if (buffer.length < 8) {
    if (complete) throw new GgufParseError('GGUF header is truncated');
    throw new NeedMoreBytes();
  }
  if (cursor.u32() !== MAGIC) throw new GgufParseError('Not a GGUF file: magic bytes mismatch');
  const version = cursor.u32();
  if (version !== 2 && version !== 3) throw new GgufParseError(`Unsupported GGUF version ${version}`);

  readLength(cursor, version); // tensor_count — not needed here
  const kvCount = readLength(cursor, version);

  const raw = new Map<string, string | number | boolean>();
  for (let index = 0; index < kvCount; index += 1) {
    const key = readString(cursor, version);
    if (key.startsWith('tokenizer.')) break;
    const type = cursor.u32();
    if (type === 9) {
      skipArray(cursor, version);
      continue;
    }
    raw.set(key, readScalar(cursor, type, version));
  }

  const architecture =
    typeof raw.get('general.architecture') === 'string' ? String(raw.get('general.architecture')) : undefined;
  const fileType = toInteger(raw.get('general.file_type'));
  const metadata: GgufMetadata = { version };
  if (architecture) metadata.architecture = architecture;
  if (typeof raw.get('general.name') === 'string') metadata.name = String(raw.get('general.name'));
  if (fileType !== undefined) metadata.quantization = quantizationLabel(fileType);
  if (typeof raw.get('general.size_label') === 'string') metadata.sizeLabel = String(raw.get('general.size_label'));

  if (architecture) {
    const contextLength = toInteger(raw.get(`${architecture}.context_length`));
    const blockCount = toInteger(raw.get(`${architecture}.block_count`));
    const embeddingLength = toInteger(raw.get(`${architecture}.embedding_length`));
    const headCount = toInteger(raw.get(`${architecture}.attention.head_count`));
    const headCountKv = toInteger(raw.get(`${architecture}.attention.head_count_kv`));
    if (contextLength !== undefined) metadata.contextLength = contextLength;
    if (blockCount !== undefined) metadata.blockCount = blockCount;
    if (embeddingLength !== undefined) metadata.embeddingLength = embeddingLength;
    if (headCount !== undefined) metadata.headCount = headCount;
    if (headCountKv !== undefined) metadata.headCountKv = headCountKv;
  }

  return metadata;
}

type CacheEntry = { size: number; mtimeMs: number; metadata: GgufMetadata };

const cache = new Map<string, CacheEntry>();

/** Drop every cached header. Exported for tests. */
export function clearGgufMetadataCache(): void {
  cache.clear();
}

/**
 * Read the GGUF header of `filePath` without loading the whole model.
 *
 * Reads a bounded window (4 MB, doubled up to 64 MB when the key/value block is
 * larger) and caches the result per (path, size, mtime) so repeated UI queries
 * are free. Falls back to a filename-derived quantisation label when the header
 * omits `general.file_type`.
 */
export async function readGgufMetadata(filePath: string): Promise<GgufMetadata> {
  const stat = await fs.stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.metadata;

  const handle = await fs.open(filePath, 'r');
  let metadata: GgufMetadata | null = null;
  try {
    let windowSize = Math.min(INITIAL_READ_BYTES, Math.max(stat.size, 8));
    for (;;) {
      const buffer = Buffer.alloc(windowSize);
      const { bytesRead } = await handle.read(buffer, 0, windowSize, 0);
      const view = buffer.subarray(0, bytesRead);
      const isWholeFile = bytesRead >= stat.size;
      try {
        metadata = parseHeaderInternal(view, isWholeFile);
        break;
      } catch (error) {
        if (!(error instanceof NeedMoreBytes)) throw error;
        if (windowSize >= MAX_READ_BYTES) throw new GgufParseError('GGUF metadata block exceeds the 64 MB read limit');
        windowSize = Math.min(windowSize * 2, MAX_READ_BYTES);
      }
    }
  } finally {
    await handle.close();
  }

  if (!metadata.quantization) {
    const fallback = quantizationFromFileName(filePath);
    if (fallback) metadata.quantization = fallback;
  }
  cache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, metadata });
  return metadata;
}
