import { describe, expect, it } from 'vitest';
import { cosineSimilarity, deserializeVector, serializeVector, topK } from '@process/services/semanticSearch/vectors';

describe('vector serialization', () => {
  it('round-trips a vector through the BLOB layout', () => {
    const original = [0.5, -0.25, 1.5, 0];
    const restored = deserializeVector(serializeVector(original));

    expect(Array.from(restored)).toEqual(original);
    expect(restored).toBeInstanceOf(Float32Array);
  });

  it('writes four bytes per dimension', () => {
    expect(serializeVector([1, 2, 3])).toHaveLength(12);
  });

  it('copies the bytes rather than viewing the caller buffer', () => {
    const source = Float32Array.from([1, 2]);
    const blob = serializeVector(source);
    source[0] = 99;
    expect(Array.from(deserializeVector(blob))).toEqual([1, 2]);
  });

  it('rejects a blob that is not a whole number of floats', () => {
    expect(() => deserializeVector(new Uint8Array(6))).toThrow(/multiple of 4/);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical directions and -1 for opposite ones', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([2, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([-1, 0]))).toBeCloseTo(-1);
  });

  it('is 0 for orthogonal vectors and for a zero vector', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0);
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });

  it('rejects a dimension mismatch', () => {
    expect(() => cosineSimilarity(Float32Array.from([1]), Float32Array.from([1, 2]))).toThrow(/dimension mismatch/);
  });
});

describe('topK', () => {
  const items = [
    { id: 'a', score: 0.1 },
    { id: 'b', score: 0.9 },
    { id: 'c', score: 0.5 },
    { id: 'd', score: 0.9 },
  ];

  it('returns the highest scores first', () => {
    expect(topK(items, 2, (item) => item.score).map((item) => item.id)).toEqual(['b', 'd']);
  });

  it('keeps input order for ties', () => {
    expect(topK(items, 4, (item) => item.score).map((item) => item.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('returns nothing for a non-positive k', () => {
    expect(topK(items, 0, (item) => item.score)).toEqual([]);
  });
});
