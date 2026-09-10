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

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  '.cache',
  '.hf_cache',
  '.hf_tools_venv',
  '.mlx_lm_venv',
  'venv',
  '.venv',
  'env',
  '.env',
]);

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

    const displayName = dirName
      .replace(/^mlx-community--/, '')
      .replace(/^lmstudio-community--/, '')
      .replace(/--/g, '/')
      .replace(/__/g, ' / ');

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

  const parentDir = path.basename(path.dirname(fullPath));
  let name = path.basename(fileName, path.extname(fileName));
  if (
    parentDir &&
    parentDir !== 'GGUF' &&
    parentDir !== 'models' &&
    parentDir !== 'Models' &&
    (parentDir.includes('__') || parentDir.includes('--'))
  ) {
    const parentFormatted = parentDir.replace(/(__|--)/g, ' / ');
    name = `${parentFormatted} (${name})`;
  }

  return {
    path: fullPath,
    name,
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

  if (depth === 0) {
    const rootDirName = path.basename(root);
    const selfMlx = await classifyMlxDirectory(root, rootDirName);
    if (selfMlx) {
      return [selfMlx];
    }
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const assets: LocalModelAsset[] = [];
  for (const entry of entries) {
    if (fileBudget.remaining <= 0) break;
    if (isMacMetadataFile(entry.name)) continue;

    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    const fullPath = path.join(root, entry.name);

    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        isDirectory = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue;
      }
    }

    if (isDirectory) {
      if (entry.name.startsWith('.') || IGNORED_DIR_NAMES.has(entry.name)) {
        continue;
      }

      const mlxAsset = await classifyMlxDirectory(fullPath, entry.name);
      if (mlxAsset) {
        fileBudget.remaining -= 1;
        assets.push(mlxAsset);
        continue;
      }

      const childAssets = await scanRoot(fullPath, { depth: depth + 1, fileBudget });
      if (childAssets) assets.push(...childAssets);
      continue;
    }

    if (!isFile) continue;

    const asset = await classifyFile(fullPath, entry.name);
    if (asset) {
      fileBudget.remaining -= 1;
      assets.push(asset);
    }
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

  const rawModels = scanned.flatMap(({ assets }) => assets);
  const seenCanonicalPaths = new Set<string>();
  const deduplicatedModels: LocalModelAsset[] = [];

  for (const model of rawModels) {
    const canonical = await fs.realpath(model.path).catch(() => path.resolve(model.path));
    if (!seenCanonicalPaths.has(canonical)) {
      seenCanonicalPaths.add(canonical);
      deduplicatedModels.push(model);
    }
  }

  return {
    roots: scanned.map(({ path: rootPath, exists }) => ({ path: rootPath, exists })),
    models: deduplicatedModels,
  };
}
