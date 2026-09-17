/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** What a catalog model is for: chat completion or text embeddings. */
export type CatalogModelKind = 'chat' | 'embedding';

export type CatalogModel = {
  /** Stable identifier used by the download bridge. */
  id: string;
  /** File name written into the target model directory. */
  file: string;
  /** Hugging Face repository the file is resolved from. */
  repo: string;
  /** Exact byte size of the published file. */
  bytes: number;
  /** Lower-case hex SHA-256 the downloaded file must match. */
  sha256: string;
  /** Display label. */
  label: string;
  kind: CatalogModelKind;
  /** Suggested first download for a new install. */
  recommendedDefault?: boolean;
};

/**
 * Curated GGUF models offered for one-click download.
 *
 * Sizes and checksums are pinned: {@link downloadVerified} rejects any file that
 * does not match, so a tampered mirror or truncated transfer can never land in
 * the model directory.
 */
export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    id: 'qwen3-4b-q4km',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    repo: 'Qwen/Qwen3-4B-GGUF',
    bytes: 2497280256,
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    label: 'Qwen3 4B (Q4_K_M)',
    kind: 'chat',
    recommendedDefault: true,
  },
  {
    id: 'phi4-mini-q4km',
    file: 'microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    repo: 'bartowski/microsoft_Phi-4-mini-instruct-GGUF',
    bytes: 2491874688,
    sha256: '01999f17c39cc3074afae5e9c539bc82d45f2dd7faa3917c66cbef76fce8c0c2',
    label: 'Phi-4 mini instruct (Q4_K_M)',
    kind: 'chat',
  },
  {
    id: 'llama32-3b-q4km',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    bytes: 2019377696,
    sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
    label: 'Llama 3.2 3B Instruct (Q4_K_M)',
    kind: 'chat',
  },
  {
    id: 'gemma3-4b-q4km',
    file: 'gemma-3-4b-it-Q4_K_M.gguf',
    repo: 'ggml-org/gemma-3-4b-it-GGUF',
    bytes: 2489757856,
    sha256: '882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863',
    label: 'Gemma 3 4B IT (Q4_K_M)',
    kind: 'chat',
  },
  {
    id: 'qwen25-coder-7b-q4km',
    file: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    repo: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    bytes: 4683073536,
    sha256: '509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c',
    label: 'Qwen2.5 Coder 7B Instruct (Q4_K_M)',
    kind: 'chat',
  },
  {
    id: 'qwen3-8b-q4km',
    file: 'Qwen3-8B-Q4_K_M.gguf',
    repo: 'unsloth/Qwen3-8B-GGUF',
    bytes: 5027784512,
    sha256: '120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4',
    label: 'Qwen3 8B (Q4_K_M)',
    kind: 'chat',
  },
  {
    id: 'nomic-embed-v15-q4km',
    file: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
    repo: 'nomic-ai/nomic-embed-text-v1.5-GGUF',
    bytes: 84106624,
    sha256: 'd4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac',
    label: 'Nomic Embed Text v1.5 (Q4_K_M)',
    kind: 'embedding',
  },
];

/** Hugging Face `resolve/main` download URL for a catalog entry. */
export function catalogDownloadUrl(model: CatalogModel): string {
  return `https://huggingface.co/${model.repo}/resolve/main/${model.file}`;
}

/** Look up a catalog entry by id, or `undefined` when the id is unknown. */
export function findCatalogModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((model) => model.id === id);
}
