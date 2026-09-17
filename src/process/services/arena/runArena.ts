/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import type {
  ArenaModelRef,
  ArenaRunRequest,
  ArenaSide,
  ArenaSideStats,
  ArenaStreamEvent,
} from '@/common/adapter/ipcBridge';

/**
 * Minimal structural view of the rotating clients. Each concrete client types
 * `createChatCompletion` against its own SDK, so the union cannot be called
 * directly; every implementation accepts this OpenAI-shaped payload.
 */
export type ArenaChatClient = {
  createChatCompletion(
    params: { model: string; messages: Array<{ role: 'system' | 'user'; content: string }> },
    options?: { signal?: AbortSignal }
  ): Promise<UnifiedChatCompletionResponse>;
};

/** Everything {@link runArena} needs, injected so the module stays testable. */
export type RunArenaDeps = {
  /** Builds a client for one side; rejecting here is reported as that side's error. */
  createClient: (ref: ArenaModelRef) => Promise<ArenaChatClient>;
  /** Pushes one event to the renderer. */
  emit: (event: ArenaStreamEvent) => void;
  /** Clock, in ms. Defaults to `Date.now`. */
  now?: () => number;
};

/** Handle on an in-flight comparison. */
export type ArenaRun = {
  runId: string;
  /** Resolves once both sides have emitted their terminal event. */
  completed: Promise<void>;
  /** Abort both sides; each unfinished side reports `cancelled`. */
  cancel: () => void;
};

const SIDES: ArenaSide[] = ['left', 'right'];

/** Rough token count used when a provider returns no `usage` block. */
function approximateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / 4));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildStats(params: { elapsedMs: number; content: string; usageTokens?: number }): ArenaSideStats {
  const estimated = params.usageTokens === undefined;
  const outputTokens = params.usageTokens ?? approximateTokens(params.content);
  const seconds = params.elapsedMs / 1000;
  return {
    // Non-streaming calls deliver the whole answer at once, so first byte and
    // completion are the same instant.
    ttfbMs: params.elapsedMs,
    totalMs: params.elapsedMs,
    outputTokens,
    tokensPerSecond: seconds > 0 ? outputTokens / seconds : 0,
    estimated,
  };
}

/**
 * Run one prompt against two models at the same time and stream the result.
 *
 * The rotating API clients expose no streaming method, so each side issues a
 * single non-streaming completion: its whole answer arrives as one `delta`, and
 * the stats measure total latency with token counts taken from the response's
 * `usage` block (falling back to a length estimate flagged as `estimated`).
 *
 * A failure on one side never cancels the other — each side is isolated and
 * always ends with exactly one terminal (`done`) event.
 *
 * @returns A handle whose `completed` promise resolves after both terminal events.
 */
export function runArena(request: ArenaRunRequest & { runId: string }, deps: RunArenaDeps): ArenaRun {
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  const settled = new Set<ArenaSide>();
  let cancelled = false;

  const finish = (side: ArenaSide, event: Omit<ArenaStreamEvent, 'runId' | 'side'>): void => {
    if (settled.has(side)) return;
    settled.add(side);
    deps.emit({ runId: request.runId, side, ...event });
  };

  const runSide = async (side: ArenaSide, ref: ArenaModelRef): Promise<void> => {
    const startedAt = now();
    try {
      const client = await deps.createClient(ref);
      const completion = await client.createChatCompletion(
        {
          model: ref.model,
          messages: request.systemPrompt
            ? [
                { role: 'system', content: request.systemPrompt },
                { role: 'user', content: request.prompt },
              ]
            : [{ role: 'user', content: request.prompt }],
        },
        { signal: controller.signal }
      );
      if (cancelled) {
        finish(side, { done: true, error: 'cancelled' });
        return;
      }
      const content = completion.choices?.[0]?.message?.content ?? '';
      if (content) deps.emit({ runId: request.runId, side, delta: content });
      finish(side, {
        done: true,
        stats: buildStats({
          elapsedMs: now() - startedAt,
          content,
          usageTokens: completion.usage?.completion_tokens,
        }),
      });
    } catch (error) {
      finish(side, { done: true, error: cancelled ? 'cancelled' : toMessage(error) });
    }
  };

  const completed = Promise.all([runSide('left', request.left), runSide('right', request.right)]).then(
    (): undefined => undefined
  );

  return {
    runId: request.runId,
    completed,
    cancel: () => {
      cancelled = true;
      controller.abort();
      for (const side of SIDES) finish(side, { done: true, error: 'cancelled' });
    },
  };
}
