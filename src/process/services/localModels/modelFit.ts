/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** How comfortably a model is expected to run on the current machine. */
export type ModelFitVerdict = 'fits' | 'tight' | 'wontFit';

export type ModelFitInput = {
  /** On-disk size of the GGUF file; used directly as the weight footprint. */
  sizeBytes: number;
  /** Context the estimate is made for. Also the ceiling for the recommendation. */
  contextSize: number;
  /** `<arch>.block_count` — transformer layers. Without it the KV cache is not estimated. */
  blockCount?: number;
  /** `<arch>.embedding_length` — hidden size. */
  embeddingLength?: number;
  /** `<arch>.attention.head_count`. */
  headCount?: number;
  /** `<arch>.attention.head_count_kv` for grouped-query attention. */
  headCountKv?: number;
  /** `os.totalmem()`. */
  totalMemoryBytes: number;
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** `process.arch`. */
  arch: string;
};

export type ModelFitEstimate = {
  verdict: ModelFitVerdict;
  /** Bytes attributed to the model weights. */
  weightsBytes: number;
  /** Estimated f16 KV cache at {@link ModelFitInput.contextSize}. */
  kvCacheBytes: number;
  /** Fixed allocator / runtime headroom. */
  overheadBytes: number;
  /** weights + KV cache + overhead. */
  requiredBytes: number;
  /** Share of total RAM we are willing to hand to one model. */
  budgetBytes: number;
  recommended: {
    contextSize: number;
    gpuLayers: number;
  };
};

/** Fixed runtime headroom on top of weights and KV cache. */
const OVERHEAD_BYTES = 512 * 1024 * 1024;
/** Context sizes offered as recommendations, ascending. */
const CONTEXT_LADDER = [4096, 8192, 16384, 32768, 65536] as const;
const MIN_CONTEXT = CONTEXT_LADDER[0];

function isUnifiedMemory(platform: NodeJS.Platform, arch: string): boolean {
  return platform === 'darwin' && arch === 'arm64';
}

/**
 * Memory budget for a single model. Apple Silicon shares one pool between CPU and
 * GPU so more of it is usable; elsewhere we only count system RAM (discrete VRAM
 * is not detected) and stay more conservative.
 */
function budgetFor(input: ModelFitInput): number {
  const ratio = isUnifiedMemory(input.platform, input.arch) ? 0.75 : 0.6;
  return input.totalMemoryBytes * ratio;
}

/** f16 KV cache for `contextSize` tokens, honouring grouped-query attention. */
function kvCacheBytes(input: ModelFitInput, contextSize: number): number {
  const { blockCount, embeddingLength } = input;
  if (!blockCount || !embeddingLength) return 0;
  const headCount = input.headCount ?? 1;
  const kvHeads = input.headCountKv ?? input.headCount ?? 1;
  const kvDim = (embeddingLength * kvHeads) / headCount;
  // 2 tensors (K and V) × layers × tokens × kv dimension × 2 bytes per f16 element.
  return 2 * blockCount * contextSize * kvDim * 2;
}

function verdictFor(requiredBytes: number, budgetBytes: number): ModelFitVerdict {
  if (requiredBytes <= budgetBytes * 0.7) return 'fits';
  if (requiredBytes <= budgetBytes) return 'tight';
  return 'wontFit';
}

/**
 * Estimate whether a local GGUF model fits in memory, and recommend runtime
 * options for it.
 *
 * Pure: every machine fact (total memory, platform, arch) is supplied by the
 * caller, so the estimator is fully unit-testable.
 */
export function estimateModelFit(input: ModelFitInput): ModelFitEstimate {
  const budgetBytes = budgetFor(input);
  const weightsBytes = input.sizeBytes;
  const cacheBytes = kvCacheBytes(input, input.contextSize);
  const requiredBytes = weightsBytes + cacheBytes + OVERHEAD_BYTES;
  const verdict = verdictFor(requiredBytes, budgetBytes);

  let recommendedContext: number = MIN_CONTEXT;
  for (const candidate of CONTEXT_LADDER) {
    if (candidate > input.contextSize) break;
    const candidateRequired = weightsBytes + kvCacheBytes(input, candidate) + OVERHEAD_BYTES;
    if (verdictFor(candidateRequired, budgetBytes) !== 'wontFit') recommendedContext = candidate;
  }

  const recommendedGpuLayers = isUnifiedMemory(input.platform, input.arch)
    ? verdict === 'wontFit'
      ? 0
      : 99
    : verdict === 'fits'
      ? 99
      : 0;

  return {
    verdict,
    weightsBytes,
    kvCacheBytes: cacheBytes,
    overheadBytes: OVERHEAD_BYTES,
    requiredBytes,
    budgetBytes,
    recommended: {
      contextSize: recommendedContext,
      gpuLayers: recommendedGpuLayers,
    },
  };
}
