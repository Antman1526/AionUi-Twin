/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Kind of local model asset, inferred from its file extension.
 */
export type LocalModelKind = 'llm' | 'stt' | 'tts';

/**
 * On-disk format of a local model asset.
 */
export type LocalModelFormat = 'gguf' | 'bin' | 'onnx' | 'mlx';

/**
 * Runtime suggested to serve a given asset kind.
 */
export type LocalModelRuntime = 'llama.cpp' | 'whisper.cpp' | 'piper' | 'mlx';

/**
 * A discovered local model asset.
 */
export type LocalModelAsset = {
  /** Absolute path to the model file. */
  path: string;
  /** Base name without extension, used as the display name and server alias. */
  name: string;
  kind: LocalModelKind;
  format: LocalModelFormat;
  suggestedRuntime: LocalModelRuntime;
  /** File size in bytes. */
  sizeBytes: number;
};

/**
 * Result of scanning the configured local model directories.
 */
export type LocalModelScanResult = {
  /** Each requested root and whether it currently exists (unmounted volumes report false). */
  roots: Array<{ path: string; exists: boolean }>;
  models: LocalModelAsset[];
};

export const LOCAL_MODEL_SCAN_MAX_DEPTH = 8;
export const LOCAL_MODEL_SCAN_MAX_FILES = 2_000;

type FormatRule = {
  format: LocalModelFormat;
  kind: LocalModelKind;
  suggestedRuntime: LocalModelRuntime;
};

/**
 * Extension → asset classification. Only these extensions are treated as models;
 * everything else (logs, metadata, archives) is ignored.
 */
const FORMAT_RULES: Record<string, FormatRule> = {
  '.gguf': { format: 'gguf', kind: 'llm', suggestedRuntime: 'llama.cpp' },
  '.safetensors': { format: 'mlx', kind: 'llm', suggestedRuntime: 'mlx' },
  '.bin': { format: 'bin', kind: 'stt', suggestedRuntime: 'whisper.cpp' },
  '.onnx': { format: 'onnx', kind: 'tts', suggestedRuntime: 'piper' },
};

/**
 * macOS AppleDouble sidecar / metadata files that must never be treated as models.
 */
function isMacMetadataFile(fileName: string): boolean {
  return fileName.startsWith('._') || fileName === '.DS_Store';
}

async function classifyMlxDirectory(dirPath: string, dirName: string): Promise<LocalModelAsset | null> {
  if (isMacMetadataFile(dirName)) return null;

  try {
    const files = await fs.readdir(dirPath);
    const hasConfig = files.includes('config.json');
    const hasWeights = files.some(
      (f) => f.endsWith('.safetensors') || f.endsWith('.npz') || f.endsWith('.bin') || f.endsWith('.model')
    );

    if (!hasConfig || !hasWeights) {
      return null;
    }

    let totalSizeBytes = 0;
    for (const f of files) {
      if (!isMacMetadataFile(f)) {
        try {
          const stat = await fs.stat(path.join(dirPath, f));
          if (stat.isFile()) totalSizeBytes += stat.size;
        } catch {
          /* ignore */
        }
      }
    }

    const displayName = dirName.replace(/^mlx-community--/, '').replace(/--/g, '/');

    return {
      path: dirPath,
      name: `${displayName} (MLX)`,
      kind: 'llm',
      format: 'mlx',
      suggestedRuntime: 'mlx',
      sizeBytes: totalSizeBytes,
    };
  } catch {
    return null;
  }
}

async function classifyFile(fullPath: string, fileName: string): Promise<LocalModelAsset | null> {
  if (isMacMetadataFile(fileName)) return null;
  const rule = FORMAT_RULES[path.extname(fileName).toLowerCase()];
  if (!rule) return null;

  let sizeBytes = 0;
  try {
    sizeBytes = (await fs.stat(fullPath)).size;
  } catch {
    return null;
  }

  return {
    path: fullPath,
    name: path.basename(fileName, path.extname(fileName)),
    kind: rule.kind,
    format: rule.format,
    suggestedRuntime: rule.suggestedRuntime,
    sizeBytes,
  };
}

/**
 * Recursively collect model assets under `root`. Resolves to `null` when the
 * directory cannot be read (missing / unmounted volume), so the caller can
 * report `exists: false` without throwing.
 */
async function scanRoot(
  root: string,
  {
    depth,
    fileBudget,
  }: {
    depth: number;
    fileBudget: { remaining: number };
  }
): Promise<LocalModelAsset[] | null> {
  if (depth > LOCAL_MODEL_SCAN_MAX_DEPTH || fileBudget.remaining <= 0) return [];

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const assets: LocalModelAsset[] = [];
  for (const entry of entries) {
    if (fileBudget.remaining <= 0) break;

    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const mlxAsset = await classifyMlxDirectory(fullPath, entry.name);
      if (mlxAsset) {
        assets.push(mlxAsset);
        continue;
      }

      const childAssets = await scanRoot(fullPath, { depth: depth + 1, fileBudget });
      if (childAssets) assets.push(...childAssets);
      continue;
    }
    if (!entry.isFile()) continue;

    fileBudget.remaining -= 1;
    const asset = await classifyFile(fullPath, entry.name);
    if (asset) assets.push(asset);
  }

  return assets;
}

/**
 * Recursively scan the given roots for supported local model assets.
 *
 * Missing roots are reported (`exists: false`) rather than throwing, so an
 * unmounted external volume never breaks discovery.
 */
export async function scanLocalModelDirectories({
  roots,
}: {
  roots: readonly string[];
}): Promise<LocalModelScanResult> {
  const scanned = await Promise.all(
    roots.map(async (root) => {
      const assets = await scanRoot(root, { depth: 0, fileBudget: { remaining: LOCAL_MODEL_SCAN_MAX_FILES } });
      return { path: root, exists: assets !== null, assets: assets ?? [] };
    })
  );

  return {
    roots: scanned.map(({ path: rootPath, exists }) => ({ path: rootPath, exists })),
    models: scanned.flatMap(({ assets }) => assets),
  };
}
