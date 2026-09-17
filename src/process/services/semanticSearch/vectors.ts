/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pack an embedding into the little-endian Float32 byte layout stored in the
 * `message_embeddings.vector` BLOB column.
 */
export function serializeVector(vector: readonly number[] | Float32Array): Buffer {
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  // Copy rather than view the caller's buffer: the row may be written later.
  return Buffer.from(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength));
}

/**
 * Read a vector back out of a stored BLOB.
 *
 * The bytes are copied because SQLite drivers may hand back a view into a
 * reused buffer, and the returned array is cached for the lifetime of a query.
 */
export function deserializeVector(blob: Uint8Array | ArrayBuffer): Float32Array {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(`deserializeVector: blob length ${bytes.byteLength} is not a multiple of 4`);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

/**
 * Cosine similarity of two equal-length vectors.
 *
 * @returns A value in [-1, 1]; 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Highest-scoring `k` items, best first.
 *
 * Ties keep their original relative order, so a stable input yields a stable
 * result page.
 */
export function topK<T>(items: readonly T[], k: number, score: (item: T) => number): T[] {
  if (k <= 0) return [];
  return items
    .map((item, index) => ({ item, index, value: score(item) }))
    .sort((a, b) => (b.value === a.value ? a.index - b.index : b.value - a.value))
    .slice(0, k)
    .map((entry) => entry.item);
}
