/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const BYTES_PER_FLOAT32 = 4;

/**
 * Pack an embedding into the raw little/big-endian Float32 bytes stored in the
 * `message_embeddings.vector` BLOB column. The returned buffer owns its memory,
 * so mutating the source afterwards cannot corrupt a pending write.
 */
export function serializeVector(vector: readonly number[] | Float32Array): Buffer {
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return Buffer.from(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength));
}

/**
 * Unpack a stored BLOB back into a Float32Array. The bytes are copied into a
 * fresh buffer because SQLite buffers are not guaranteed to be 4-byte aligned.
 */
export function deserializeVector(blob: Uint8Array | ArrayBuffer): Float32Array {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.byteLength % BYTES_PER_FLOAT32 !== 0) {
    throw new Error(`Invalid embedding blob: ${bytes.byteLength} bytes is not a multiple of ${BYTES_PER_FLOAT32}`);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

/**
 * Cosine similarity in [-1, 1]. Mismatched dimensions or a zero-length vector
 * score 0 so a stale row from a different embedding model can never win.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Highest-scoring `limit` items, ordered best first. */
export function topK<T extends { score: number }>(items: readonly T[], limit: number): T[] {
  if (limit <= 0) return [];
  return [...items].toSorted((a, b) => b.score - a.score).slice(0, limit);
}
