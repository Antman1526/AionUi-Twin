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
export type LocalModelFormat = 'gguf' | 'bin' | 'onnx';

/**
 * Runtime suggested to serve a given asset kind.
 */
export type LocalModelRuntime = 'llama.cpp' | 'whisper.cpp' | 'piper';

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
  '.bin': { format: 'bin', kind: 'stt', suggestedRuntime: 'whisper.cpp' },
  '.onnx': { format: 'onnx', kind: 'tts', suggestedRuntime: 'piper' },
};

/**
 * macOS AppleDouble sidecar / metadata files that must never be treated as models.
 */
function isMacMetadataFile(fileName: string): boolean {
  return fileName.startsWith('._') || fileName === '.DS_Store';
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
async function scanRoot(root: string): Promise<LocalModelAsset[] | null> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return (await scanRoot(fullPath)) ?? [];
      if (!entry.isFile()) return [];
      const asset = await classifyFile(fullPath, entry.name);
      return asset ? [asset] : [];
    })
  );

  return nested.flat();
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
      const assets = await scanRoot(root);
      return { path: root, exists: assets !== null, assets: assets ?? [] };
    })
  );

  return {
    roots: scanned.map(({ path: rootPath, exists }) => ({ path: rootPath, exists })),
    models: scanned.flatMap(({ assets }) => assets),
  };
}
