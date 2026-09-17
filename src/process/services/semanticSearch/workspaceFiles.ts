/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Extensions indexed by {@link collectWorkspaceFiles}. Anything else is ignored. */
export const INDEXABLE_EXTENSIONS: readonly string[] = [
  '.md',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.py',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.rs',
  '.go',
  '.java',
  '.css',
  '.html',
];

/** Directory names never descended into. */
export const SKIPPED_DIRECTORIES: readonly string[] = ['node_modules', '.git', 'dist', 'out', 'build'];

/** Files larger than this are skipped; they are generated bundles far more often than prose. */
export const MAX_INDEXABLE_FILE_BYTES = 512 * 1024;

/** Depth cap so a symlink loop or a pathological tree cannot hang indexing. */
const MAX_DEPTH = 12;

/** A workspace file selected for indexing. */
export type WorkspaceFileEntry = {
  absolutePath: string;
  /** Path relative to the workspace root, POSIX-separated. */
  relativePath: string;
  sizeBytes: number;
  modifiedAt: number;
};

/** Whether a file name has an indexable extension. */
export function isIndexableFile(fileName: string): boolean {
  return INDEXABLE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

/**
 * Heuristic binary check: a NUL byte in the first bytes of the file.
 *
 * Text formats never contain one, and every binary container this would
 * otherwise index (fonts, images renamed to `.txt`) does.
 */
export function looksBinary(sample: Buffer | Uint8Array): boolean {
  return sample.includes(0);
}

/**
 * Walk a workspace and list every file worth embedding.
 *
 * @param workspacePath Absolute path to the workspace root.
 * @returns Indexable files, sorted by relative path for a stable index order.
 */
export async function collectWorkspaceFiles(workspacePath: string): Promise<WorkspaceFileEntry[]> {
  const results: WorkspaceFileEntry[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isIndexableFile(entry.name)) continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_INDEXABLE_FILE_BYTES) continue;
        results.push({
          absolutePath: fullPath,
          relativePath: path.relative(workspacePath, fullPath).split(path.sep).join('/'),
          sizeBytes: stat.size,
          modifiedAt: Math.round(stat.mtimeMs),
        });
      } catch {
        /* unreadable file: skip */
      }
    }
  };

  await walk(workspacePath, 0);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

/**
 * Read a workspace file as UTF-8 text.
 *
 * @returns The file's text, or null when it is unreadable or looks binary.
 */
export async function readTextFile(absolutePath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(absolutePath);
    if (looksBinary(buffer.subarray(0, 1024))) return null;
    return buffer.toString('utf-8');
  } catch {
    return null;
  }
}
