import { describe, expect, it } from 'vitest';
import { estimateModelFit, type ModelFitInput } from '@process/services/localModels/modelFit';

const GB = 1024 * 1024 * 1024;

/** A 7B-class Q4_K_M model with grouped-query attention (4 KV heads of 28). */
function sevenBillion(overrides: Partial<ModelFitInput> = {}): ModelFitInput {
  return {
    sizeBytes: 4_700_000_000,
    contextSize: 16_384,
    blockCount: 28,
    embeddingLength: 3584,
    headCount: 28,
    headCountKv: 4,
    totalMemoryBytes: 16 * GB,
    platform: 'darwin',
    arch: 'arm64',
    ...overrides,
  };
}

describe('estimateModelFit', () => {
  it('estimates the f16 KV cache from block count, embedding length and KV heads', () => {
    const estimate = estimateModelFit(sevenBillion());
    // kvDim = 3584 * 4 / 28 = 512 → 2 * 28 * 16384 * 512 * 2 bytes
    expect(estimate.kvCacheBytes).toBe(2 * 28 * 16_384 * 512 * 2);
    expect(estimate.overheadBytes).toBe(512 * 1024 * 1024);
    expect(estimate.requiredBytes).toBe(estimate.weightsBytes + estimate.kvCacheBytes + estimate.overheadBytes);
  });

  it('rates a 4.7 GB 7B model at 16k context on a 16 GB Apple Silicon Mac as runnable', () => {
    const estimate = estimateModelFit(sevenBillion());
    expect(estimate.budgetBytes).toBe(16 * GB * 0.75);
    expect(estimate.verdict).toBe('fits');
    expect(estimate.recommended.gpuLayers).toBe(99);
    expect(estimate.recommended.contextSize).toBe(16_384);
  });

  it('rates a 16 GB model on a 16 GB machine as wontFit', () => {
    const estimate = estimateModelFit(sevenBillion({ sizeBytes: 16 * GB }));
    expect(estimate.verdict).toBe('wontFit');
    expect(estimate.recommended.gpuLayers).toBe(0);
    expect(estimate.recommended.contextSize).toBe(4096);
  });

  it('uses a 60% budget off Apple Silicon, since discrete VRAM is not detected', () => {
    const estimate = estimateModelFit(sevenBillion({ platform: 'linux', arch: 'x64' }));
    expect(estimate.budgetBytes).toBe(16 * GB * 0.6);
    expect(estimate.verdict).toBe('fits');
    expect(estimate.recommended.gpuLayers).toBe(99);
  });

  it('drops GPU offload to 0 on a non-unified platform once the fit is only tight', () => {
    const estimate = estimateModelFit(sevenBillion({ sizeBytes: 8 * GB, platform: 'linux', arch: 'x64' }));
    expect(estimate.verdict).toBe('tight');
    expect(estimate.recommended.gpuLayers).toBe(0);
  });

  it('keeps 99 GPU layers on Apple Silicon even when the fit is only tight', () => {
    const estimate = estimateModelFit(sevenBillion({ sizeBytes: 10 * GB }));
    expect(estimate.verdict).toBe('tight');
    expect(estimate.recommended.gpuLayers).toBe(99);
  });

  it('never recommends more context than the model was trained for', () => {
    const estimate = estimateModelFit(sevenBillion({ sizeBytes: 1_000_000_000, contextSize: 8192 }));
    expect(estimate.recommended.contextSize).toBe(8192);
  });

  it('climbs the context ladder when memory allows', () => {
    const estimate = estimateModelFit(
      sevenBillion({ sizeBytes: 1_000_000_000, contextSize: 131_072, totalMemoryBytes: 64 * GB })
    );
    expect(estimate.recommended.contextSize).toBe(65_536);
  });

  it('falls back to a 4096 recommendation when even the smallest context will not fit', () => {
    const estimate = estimateModelFit(sevenBillion({ sizeBytes: 40 * GB, contextSize: 131_072 }));
    expect(estimate.verdict).toBe('wontFit');
    expect(estimate.recommended.contextSize).toBe(4096);
  });

  it('skips the KV estimate when the GGUF header had no block count', () => {
    const estimate = estimateModelFit(sevenBillion({ blockCount: undefined, embeddingLength: undefined }));
    expect(estimate.kvCacheBytes).toBe(0);
    expect(estimate.requiredBytes).toBe(4_700_000_000 + 512 * 1024 * 1024);
  });
});
