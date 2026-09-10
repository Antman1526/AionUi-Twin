/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HfModelDetail, HfModelFile, HfModelKind, HfModelSummary } from '@/common/adapter/ipcBridge';

const HF_BASE_URL = 'https://huggingface.co';

type HfRawModelItem = {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  lastModified?: string;
  description?: string;
  siblings?: { rfilename: string }[];
};

/**
 * Extract quantization string from a GGUF filename (e.g. "Q4_K_M", "Q8_0", "f16").
 */
function extractQuantization(fileName: string): string | undefined {
  const match = fileName.match(/(q\d+_[a-z0-9_]+|f16|f32|bf16)/i);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Search Hugging Face models tailored for GGUF and Apple Silicon native MLX.
 */
export async function searchHfModels({
  query = '',
  type = 'all',
  limit = 20,
}: {
  query?: string;
  type?: HfModelKind;
  limit?: number;
}): Promise<HfModelSummary[]> {
  const results: HfModelSummary[] = [];

  const fetchCategory = async (params: URLSearchParams, modelType: HfModelKind): Promise<HfModelSummary[]> => {
    try {
      const url = `${HF_BASE_URL}/api/models?${params.toString()}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'WE-App/2.2.2' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return [];
      const data = (await response.json()) as HfRawModelItem[];

      return data.map((item) => ({
        id: item.id,
        author: item.author ?? item.id.split('/')[0] ?? 'unknown',
        downloads: item.downloads ?? 0,
        likes: item.likes ?? 0,
        modelType,
        tags: item.tags ?? [],
        description: item.description,
        lastModified: item.lastModified,
      }));
    } catch {
      return [];
    }
  };

  // 1. Fetch GGUF models
  if (type === 'all' || type === 'gguf') {
    const ggufParams = new URLSearchParams({
      search: query ? `${query} gguf` : 'gguf',
      filter: 'gguf',
      sort: 'downloads',
      direction: '-1',
      limit: String(limit),
    });
    const ggufs = await fetchCategory(ggufParams, 'gguf');
    results.push(...ggufs);
  }

  // 2. Fetch MLX models (mlx-community or mlx tag)
  if (type === 'all' || type === 'mlx') {
    const mlxParams = new URLSearchParams({
      search: query ? `${query} mlx` : 'mlx',
      sort: 'downloads',
      direction: '-1',
      limit: String(limit),
    });
    const mlxs = await fetchCategory(mlxParams, 'mlx');
    results.push(...mlxs);
  }

  // Deduplicate and sort by downloads descending
  const seen = new Set<string>();
  const unique = results.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  unique.sort((a, b) => b.downloads - a.downloads);
  return unique.slice(0, limit);
}

/**
 * Fetch detailed files list for a Hugging Face model repository.
 */
export async function getHfModelDetails(modelId: string): Promise<HfModelDetail> {
  const cleanModelId = modelId.split('/').map(encodeURIComponent).join('/');
  const modelUrl = `${HF_BASE_URL}/api/models/${cleanModelId}`;
  const treeUrl = `${HF_BASE_URL}/api/models/${cleanModelId}/tree/main`;

  const [modelResponse, treeResponse] = await Promise.all([
    fetch(modelUrl, {
      headers: { 'User-Agent': 'WE-App/2.2.2' },
      signal: AbortSignal.timeout(15_000),
    }),
    fetch(treeUrl, {
      headers: { 'User-Agent': 'WE-App/2.2.2' },
      signal: AbortSignal.timeout(15_000),
    }).catch((): Response | null => null),
  ]);

  if (!modelResponse.ok) {
    throw new Error(`Failed to fetch Hugging Face model details (${modelResponse.status} ${modelResponse.statusText})`);
  }

  const raw = (await modelResponse.json()) as HfRawModelItem;
  const isMlx = raw.tags?.includes('mlx') || raw.id.startsWith('mlx-community/');
  const isGguf = raw.tags?.includes('gguf') || raw.id.toLowerCase().includes('gguf');
  const modelType: HfModelKind = isMlx ? 'mlx' : isGguf ? 'gguf' : 'other';

  // Build a lookup map of file sizes from repository tree
  const sizeMap = new Map<string, number>();
  if (treeResponse && treeResponse.ok) {
    try {
      const treeData = (await treeResponse.json()) as Array<{ path?: string; size?: number }>;
      if (Array.isArray(treeData)) {
        for (const item of treeData) {
          if (item.path && typeof item.size === 'number') {
            sizeMap.set(item.path, item.size);
          }
        }
      }
    } catch {
      /* ignore tree parse error */
    }
  }

  const files: HfModelFile[] = [];

  if (raw.siblings && Array.isArray(raw.siblings)) {
    for (const sib of raw.siblings) {
      const fileName = sib.rfilename;
      const sizeBytes = sizeMap.get(fileName) ?? 0;

      // For GGUF, we look for .gguf files
      if (modelType === 'gguf' && fileName.toLowerCase().endsWith('.gguf')) {
        files.push({
          name: fileName,
          path: fileName,
          sizeBytes,
          quantization: extractQuantization(fileName),
        });
      } else if (modelType === 'mlx') {
        // For MLX, include weights, configs, and tokenizers
        if (
          fileName.endsWith('.safetensors') ||
          fileName.endsWith('.json') ||
          fileName.endsWith('.npz') ||
          fileName.endsWith('.model') ||
          fileName.endsWith('.txt')
        ) {
          files.push({
            name: fileName,
            path: fileName,
            sizeBytes,
          });
        }
      }
    }
  }

  return {
    id: raw.id,
    author: raw.author ?? raw.id.split('/')[0] ?? 'unknown',
    downloads: raw.downloads ?? 0,
    likes: raw.likes ?? 0,
    modelType,
    tags: raw.tags ?? [],
    description: raw.description,
    lastModified: raw.lastModified,
    files,
  };
}
