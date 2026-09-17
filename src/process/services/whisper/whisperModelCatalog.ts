/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WhisperModelCatalogEntry } from '@/common/types/speech';

const HUGGING_FACE_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/**
 * Curated whisper.cpp GGML models offered for one-click download.
 *
 * Sizes and checksums are pinned: {@link downloadVerified} rejects any file that
 * does not match, so a tampered mirror or truncated transfer can never land in
 * the whisper model directory.
 */
export const WHISPER_MODEL_CATALOG: readonly WhisperModelCatalogEntry[] = [
  {
    id: 'base-q5_1',
    file: 'ggml-base-q5_1.bin',
    url: `${HUGGING_FACE_BASE}/ggml-base-q5_1.bin`,
    bytes: 59707625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    label: 'Base q5_1 · fastest',
  },
  {
    id: 'small-q5_1',
    file: 'ggml-small-q5_1.bin',
    url: `${HUGGING_FACE_BASE}/ggml-small-q5_1.bin`,
    bytes: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    label: 'Small q5_1 · balanced',
  },
  {
    id: 'large-v3-turbo-q5_0',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    url: `${HUGGING_FACE_BASE}/ggml-large-v3-turbo-q5_0.bin`,
    bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    label: 'Large v3 turbo q5_0 · best',
  },
];

/** Look up a catalog entry by id, or `undefined` when unknown. */
export function findWhisperCatalogModel(id: string): WhisperModelCatalogEntry | undefined {
  return WHISPER_MODEL_CATALOG.find((entry) => entry.id === id);
}
