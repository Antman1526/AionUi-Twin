/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientFactory } from '@/common/api';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import type { ArenaCompletionClient } from './arenaService';

const ARENA_TIMEOUT_MS = 180_000;

/** The subset of every rotating client the arena actually calls. */
type ArenaChatCallable = {
  createChatCompletion: (
    params: { model: string; messages: Array<{ role: string; content: string }> },
    options?: { signal?: AbortSignal; timeout?: number }
  ) => Promise<UnifiedChatCompletionResponse>;
};

/**
 * Real arena completion client. Reuses the app's existing rotating chat client
 * (`ClientFactory`), which has no streaming API — the whole answer therefore
 * arrives as a single delta.
 */
export const arenaCompletionClient: ArenaCompletionClient = async ({ provider, prompt, systemPrompt, signal }) => {
  const rotatingClient = await ClientFactory.createRotatingClient(provider, {
    timeout: ARENA_TIMEOUT_MS,
    rotatingOptions: { maxRetries: 1, retryDelay: 500 },
  });

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    ...(systemPrompt ? ([{ role: 'system', content: systemPrompt }] as const) : []),
    { role: 'user', content: prompt },
  ];

  // `ClientFactory` returns a union of three clients whose parameter types only
  // overlap structurally, so a union call site is unusable. Every branch reads
  // the same `{ model, messages }` shape, which this narrow view pins down.
  const client = rotatingClient as unknown as ArenaChatCallable;
  const completion = await client.createChatCompletion(
    { model: provider.use_model, messages },
    { signal, timeout: ARENA_TIMEOUT_MS }
  );

  const text = completion.choices?.[0]?.message?.content ?? '';
  const completionTokens = completion.usage?.completion_tokens;
  return {
    text,
    ...(typeof completionTokens === 'number' && Number.isFinite(completionTokens) ? { completionTokens } : {}),
  };
};
