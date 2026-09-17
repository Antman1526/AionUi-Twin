/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Model name sent to a managed llama-server, which serves a single model. */
export const MANAGED_EMBEDDING_MODEL = 'embedding';

/** Inputs per `/v1/embeddings` request. */
export const EMBED_BATCH_SIZE = 16;

type EmbeddingResponse = {
  data?: Array<{ embedding?: unknown; index?: unknown }>;
};

/**
 * Resolve the OpenAI-compatible embeddings endpoint for a base URL.
 *
 * Accepts both `http://host:port` and `http://host:port/v1`, matching how
 * llama-server handles and how user-configured providers are stored.
 */
export function embeddingsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/embeddings` : `${trimmed}/v1/embeddings`;
}

/**
 * Embed a batch of strings through an OpenAI-compatible `/v1/embeddings` route.
 *
 * @returns One vector per input, in input order.
 * @throws When the endpoint fails, or returns fewer vectors than inputs.
 */
export async function embedTexts({
  baseUrl,
  inputs,
  model = MANAGED_EMBEDDING_MODEL,
  apiKey,
  fetchFn = fetch,
}: {
  baseUrl: string;
  inputs: string[];
  model?: string;
  apiKey?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchFn(embeddingsEndpoint(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: inputs, encoding_format: 'float' }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const vectors: number[][] = [];
  rows.forEach((row, position) => {
    if (!Array.isArray(row.embedding)) return;
    const index = typeof row.index === 'number' ? row.index : position;
    vectors[index] = row.embedding.map((value) => Number(value));
  });

  if (vectors.length !== inputs.length || vectors.some((vector) => !vector)) {
    throw new Error(`Embedding response returned ${rows.length} vectors for ${inputs.length} inputs`);
  }
  return vectors;
}
