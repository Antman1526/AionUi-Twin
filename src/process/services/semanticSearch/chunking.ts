/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Target chunk length in characters. */
export const DEFAULT_CHUNK_SIZE = 800;
/** Characters repeated between neighbouring chunks so a match near a boundary survives. */
export const DEFAULT_CHUNK_OVERLAP = 100;

/**
 * Split text into fixed-size overlapping chunks.
 *
 * Whitespace is collapsed first so a chunk is 800 characters of content rather
 * than 800 characters of indentation. Text shorter than `size` yields exactly
 * one chunk; empty or blank text yields none.
 *
 * @param text Raw text to split.
 * @param size Maximum characters per chunk.
 * @param overlap Characters shared between consecutive chunks; must be < `size`.
 * @returns Chunks in document order.
 */
export function chunkText(text: string, size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (size <= 0) throw new Error('chunkText: size must be greater than 0');
  if (overlap < 0 || overlap >= size) throw new Error('chunkText: overlap must be >= 0 and < size');
  if (normalized.length <= size) return [normalized];

  const step = size - overlap;
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += step) {
    chunks.push(normalized.slice(start, start + size));
    if (start + size >= normalized.length) break;
  }
  return chunks;
}

/** Row id for chunk `index` of message `messageId`. */
export function chunkRowId(messageId: string, index: number): string {
  return `${messageId}#${index}`;
}

/** Row id for chunk `index` of the workspace file at `relativePath`. */
export function fileChunkRowId(relativePath: string, index: number): string {
  return `file:${relativePath}#${index}`;
}

/** Synthetic conversation id used to group every chunk of one workspace. */
export function workspaceConversationId(workspacePath: string): string {
  return `workspace:${workspacePath}`;
}
