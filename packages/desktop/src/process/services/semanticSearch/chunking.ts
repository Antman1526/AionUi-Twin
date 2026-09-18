/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Default characters per embedded chunk. */
export const DEFAULT_CHUNK_SIZE = 800;

/** Default characters shared between two consecutive chunks. */
export const DEFAULT_CHUNK_OVERLAP = 100;

export type ChunkOptions = {
  chunkSize?: number;
  overlap?: number;
};

/**
 * Split `text` into overlapping fixed-size character windows.
 *
 * Text shorter than `chunkSize` produces a single chunk, blank text produces
 * none. The overlap is clamped below `chunkSize` so the window always advances
 * and the function can never loop forever on hostile options.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE));
  const requestedOverlap = Math.max(0, Math.floor(options.overlap ?? DEFAULT_CHUNK_OVERLAP));
  const overlap = Math.min(requestedOverlap, chunkSize - 1);

  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const step = chunkSize - overlap;
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += step) {
    const chunk = normalized.slice(start, start + chunkSize).trim();
    if (chunk) chunks.push(chunk);
    if (start + chunkSize >= normalized.length) break;
  }
  return chunks;
}

/** Row id for one chunk of a chat message. */
export function messageRowId(messageId: string, chunkIndex: number): string {
  return `${messageId}#${chunkIndex}`;
}

/** Row id for one chunk of a workspace file, keyed by its workspace-relative path. */
export function fileRowId(relativePath: string, chunkIndex: number): string {
  return `file:${relativePath}#${chunkIndex}`;
}

/**
 * Split a row id back into its source key and chunk index. Message ids and
 * relative paths may themselves contain `#`, so the split is anchored on the
 * last separator.
 */
export function parseRowId(rowId: string): { key: string; chunkIndex: number } | null {
  const separator = rowId.lastIndexOf('#');
  if (separator <= 0) return null;
  const chunkIndex = Number.parseInt(rowId.slice(separator + 1), 10);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
  return { key: rowId.slice(0, separator), chunkIndex };
}
