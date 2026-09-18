/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ArenaSide, ArenaSideStats, ArenaStreamEvent } from '@/common/adapter/ipcBridge';
import type { TProviderWithModel } from '@/common/config/storage';

/** Result shape a completion client must return. Mirrors the OpenAI-compatible response subset we need. */
export type ArenaCompletionResult = {
  text: string;
  /** Present only when the upstream response carried a usage block. */
  completionTokens?: number;
};

/** Injectable chat-completion call — the real one wraps `ClientFactory.createRotatingClient`. */
export type ArenaCompletionClient = (params: {
  provider: TProviderWithModel;
  prompt: string;
  systemPrompt?: string;
  signal: AbortSignal;
}) => Promise<ArenaCompletionResult>;

export type ArenaRunOptions = {
  runId: string;
  left: TProviderWithModel;
  right: TProviderWithModel;
  prompt: string;
  systemPrompt?: string;
  complete: ArenaCompletionClient;
  emit: (event: ArenaStreamEvent) => void;
  /** Injectable clock so timings are deterministic under test. */
  now?: () => number;
};

/** Error text emitted for a side the caller cancelled. */
export const ARENA_ABORTED = 'aborted';

/**
 * Rough output-token estimate for providers that return no `usage` block.
 * ~4 characters per token is the usual English/code average; anything derived
 * from it is flagged `estimated: true` and never presented as measured.
 */
export function estimateOutputTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

const controllers = new Map<string, AbortController[]>();

/** Abort every in-flight side of a run. No-op for an unknown or finished run id. */
export function cancelArenaRun(runId: string): boolean {
  const pending = controllers.get(runId);
  if (!pending) return false;
  for (const controller of pending) controller.abort();
  return true;
}

async function runSide(side: ArenaSide, options: ArenaRunOptions, controller: AbortController): Promise<void> {
  const { runId, prompt, systemPrompt, complete, emit } = options;
  const now = options.now ?? Date.now;
  const provider = side === 'left' ? options.left : options.right;
  const startedAt = now();

  try {
    const result = await complete({ provider, prompt, systemPrompt, signal: controller.signal });
    const finishedAt = now();
    const totalMs = finishedAt - startedAt;
    const estimated = result.completionTokens === undefined;
    const outputTokens = estimated ? estimateOutputTokens(result.text) : result.completionTokens!;
    const stats: ArenaSideStats = {
      // The shared chat client has no streaming API, so first byte and last
      // byte are the same instant — ttfb is deliberately equal to totalMs.
      ttfbMs: totalMs,
      totalMs,
      outputTokens,
      tokensPerSecond: totalMs > 0 ? (outputTokens * 1000) / totalMs : 0,
      ...(estimated ? { estimated: true } : {}),
    };
    if (result.text) emit({ runId, side, delta: result.text });
    emit({ runId, side, done: true, stats });
  } catch (error) {
    const message = controller.signal.aborted ? ARENA_ABORTED : error instanceof Error ? error.message : String(error);
    emit({ runId, side, done: true, error: message });
  }
}

/**
 * Run both sides of an arena match concurrently. One side failing (or being
 * cancelled) never stops the other — each side reports its own terminal event.
 */
export async function runArenaMatch(options: ArenaRunOptions): Promise<void> {
  const leftController = new AbortController();
  const rightController = new AbortController();
  controllers.set(options.runId, [leftController, rightController]);

  try {
    await Promise.all([runSide('left', options, leftController), runSide('right', options, rightController)]);
  } finally {
    controllers.delete(options.runId);
  }
}
