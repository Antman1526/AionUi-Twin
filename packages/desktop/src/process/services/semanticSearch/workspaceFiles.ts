/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Text extensions the workspace indexer will read. */
export const INDEXABLE_EXTENSIONS: ReadonlySet<string> = new Set([
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
]);

/** Directories never descended into — build output and dependency trees. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', 'out', 'build']);

/** Files larger than this are skipped: embedding them costs more than they are worth. */
export const MAX_INDEXABLE_FILE_BYTES = 512 * 1024;

/** Upper bound on files visited in one workspace pass. */
export const MAX_WORKSPACE_FILES = 5_000;

/** Bytes inspected when deciding whether a file is binary. */
const BINARY_SNIFF_BYTES = 8_000;

export function isIndexableFileName(fileName: string): boolean {
  if (fileName.startsWith('._') || fileName === '.DS_Store') return false;
  return INDEXABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** A NUL byte near the start is the cheapest reliable binary signal. */
export function looksBinary(content: Uint8Array): boolean {
  const limit = Math.min(content.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i++) {
    if (content[i] === 0) return true;
  }
  return false;
}

/**
 * Walk `root` and return workspace-relative paths of indexable text files.
 * Unreadable directories are skipped rather than aborting the walk.
 */
export async function collectWorkspaceFiles(root: string, maxFiles = MAX_WORKSPACE_FILES): Promise<string[]> {
  const collected: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    if (collected.length >= maxFiles) return;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (collected.length >= maxFiles) return;
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      // Symlinks are not followed: they can point outside the authorized workspace.
      if (!entry.isFile()) continue;
      if (!isIndexableFileName(entry.name)) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_INDEXABLE_FILE_BYTES) continue;
      } catch {
        continue;
      }

      collected.push(path.relative(root, fullPath));
    }
  };

  await walk(root);
  return collected;
}

/**
 * Read a workspace file as UTF-8 text plus its mtime, or return null when it is
 * binary or unreadable.
 */
export async function readWorkspaceTextFile(
  root: string,
  relativePath: string
): Promise<{ text: string; modifiedAt: number } | null> {
  const fullPath = path.join(root, relativePath);
  try {
    const [content, stat] = await Promise.all([fs.readFile(fullPath), fs.stat(fullPath)]);
    if (looksBinary(content)) return null;
    return { text: content.toString('utf-8'), modifiedAt: Math.floor(stat.mtimeMs) };
  } catch {
    return null;
  }
}
