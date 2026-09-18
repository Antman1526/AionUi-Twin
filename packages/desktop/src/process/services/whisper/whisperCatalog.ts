/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Curated whisper.cpp ggml model catalog.
 *
 * Every `sizeBytes` / `sha256` pair below was read from the Hugging Face tree
 * API for `ggerganov/whisper.cpp` (`size` and `lfs.oid` respectively) — none of
 * them are guessed. The downloader enforces both, so a corrupted or swapped
 * file is rejected instead of being handed to `whisper-server`.
 */

export const WHISPER_MODEL_REPO = 'ggerganov/whisper.cpp';

const RESOLVE_BASE = `https://huggingface.co/${WHISPER_MODEL_REPO}/resolve/main`;

export type WhisperCatalogEntry = {
  /** Stable id used by the download bridge method. */
  id: string;
  /** File name on disk, identical to the repo path. */
  fileName: string;
  /** Human-readable size/quality hint; not user-facing text (no i18n needed). */
  label: string;
  sizeBytes: number;
  /** Lowercase hex sha256 (Hugging Face `lfs.oid`). */
  sha256: string;
};

export const WHISPER_MODEL_CATALOG: readonly WhisperCatalogEntry[] = [
  {
    id: 'base-q5_1',
    fileName: 'ggml-base-q5_1.bin',
    label: 'Base (q5_1)',
    sizeBytes: 59_707_625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  },
  {
    id: 'small-q5_1',
    fileName: 'ggml-small-q5_1.bin',
    label: 'Small (q5_1)',
    sizeBytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
  {
    id: 'large-v3-turbo-q5_0',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    label: 'Large v3 Turbo (q5_0)',
    sizeBytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
];

export function getWhisperCatalogEntry(id: string): WhisperCatalogEntry | undefined {
  return WHISPER_MODEL_CATALOG.find((entry) => entry.id === id);
}

export function buildWhisperModelUrl(entry: WhisperCatalogEntry): string {
  return `${RESOLVE_BASE}/${entry.fileName}`;
}
