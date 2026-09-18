/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { ArenaStreamEvent } from '@/common/adapter/ipcBridge';
import type { TProviderWithModel } from '@/common/config/storage';
import {
  ARENA_ABORTED,
  cancelArenaRun,
  estimateOutputTokens,
  runArenaMatch,
  type ArenaCompletionClient,
} from '@process/services/arena/arenaService';

const provider = (name: string, model: string): TProviderWithModel =>
  ({
    id: name,
    name,
    platform: 'custom',
    base_url: 'http://127.0.0.1:1/v1',
    api_key: '',
    use_model: model,
  }) as TProviderWithModel;

const LEFT = provider('left-provider', 'model-a');
const RIGHT = provider('right-provider', 'model-b');

/** Deterministic clock: every read advances by `stepMs`. */
const steppingClock = (stepMs: number) => {
  let value = 0;
  return () => {
    value += stepMs;
    return value;
  };
};

/** Stateless fake clients hoisted out of the tests (lint: consistent-function-scoping). */
const usageClient: ArenaCompletionClient = async () => ({ text: 'hello world', completionTokens: 8 });

const noUsageClient: ArenaCompletionClient = async () => ({ text: 'x'.repeat(400) });

const leftFailsClient: ArenaCompletionClient = async ({ provider: p }) => {
  if (p.use_model === 'model-a') throw new Error('rate limited');
  return { text: 'right answer', completionTokens: 3 };
};

const neverSettlesClient: ArenaCompletionClient = ({ signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
  });

describe('runArenaMatch', () => {
  it('starts both sides before either resolves', async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const complete: ArenaCompletionClient = ({ provider: p }) => {
      started.push(p.use_model);
      return new Promise((resolve) => {
        release.push(() => resolve({ text: 'ok', completionTokens: 1 }));
      });
    };

    const events: ArenaStreamEvent[] = [];
    const run = runArenaMatch({
      runId: 'r1',
      left: LEFT,
      right: RIGHT,
      prompt: 'hi',
      complete,
      emit: (event) => events.push(event),
    });

    await Promise.resolve();
    expect(started).toEqual(['model-a', 'model-b']);
    expect(events).toHaveLength(0);

    for (const fn of release) fn();
    await run;
    expect(events.filter((event) => event.done)).toHaveLength(2);
  });

  it('reports measured token counts when the response carries usage', async () => {
    const events: ArenaStreamEvent[] = [];
    await runArenaMatch({
      runId: 'r2',
      left: LEFT,
      right: RIGHT,
      prompt: 'hi',
      complete: usageClient,
      emit: (event) => events.push(event),
      now: steppingClock(500),
    });

    // Both sides share the clock, so each interleaved read advances it by 500ms:
    // left starts at 500, right at 1000, left finishes at 1500 → 1000ms total.
    const done = events.find((event) => event.side === 'left' && event.done);
    expect(done?.stats).toEqual({ ttfbMs: 1000, totalMs: 1000, outputTokens: 8, tokensPerSecond: 8 });
    expect(done?.stats?.estimated).toBeUndefined();
    expect(events.find((event) => event.side === 'left' && event.delta)?.delta).toBe('hello world');
  });

  it('flags estimated token counts when no usage block came back', async () => {
    const events: ArenaStreamEvent[] = [];
    await runArenaMatch({
      runId: 'r3',
      left: LEFT,
      right: RIGHT,
      prompt: 'hi',
      complete: noUsageClient,
      emit: (event) => events.push(event),
      now: steppingClock(1000),
    });

    const done = events.find((event) => event.side === 'right' && event.done);
    expect(done?.stats?.estimated).toBe(true);
    expect(done?.stats?.outputTokens).toBe(100);
    // Non-streaming client: first byte and last byte are the same instant.
    expect(done?.stats?.ttfbMs).toBe(done?.stats?.totalMs);
  });

  it('keeps the other side alive when one side throws', async () => {
    const events: ArenaStreamEvent[] = [];
    await runArenaMatch({
      runId: 'r4',
      left: LEFT,
      right: RIGHT,
      prompt: 'hi',
      complete: leftFailsClient,
      emit: (event) => events.push(event),
      now: steppingClock(100),
    });

    const left = events.find((event) => event.side === 'left' && event.done);
    const right = events.find((event) => event.side === 'right' && event.done);
    expect(left?.error).toBe('rate limited');
    expect(left?.stats).toBeUndefined();
    expect(right?.error).toBeUndefined();
    expect(right?.stats?.outputTokens).toBe(3);
  });

  it('cancels both in-flight sides and reports them as aborted', async () => {
    const events: ArenaStreamEvent[] = [];
    const run = runArenaMatch({
      runId: 'r5',
      left: LEFT,
      right: RIGHT,
      prompt: 'hi',
      complete: neverSettlesClient,
      emit: (event) => events.push(event),
    });

    await Promise.resolve();
    expect(cancelArenaRun('r5')).toBe(true);
    await run;

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.done && event.error === ARENA_ABORTED)).toBe(true);
    // The registry is cleared once the run settles.
    expect(cancelArenaRun('r5')).toBe(false);
  });

  it('does not cancel a run id it never issued', () => {
    expect(cancelArenaRun('never-existed')).toBe(false);
  });

  it('emits no delta for an empty answer', async () => {
    const emit = vi.fn();
    await runArenaMatch({
      runId: 'r6',
      left: LEFT,
      right: RIGHT,
      prompt: 'hi',
      complete: async () => ({ text: '', completionTokens: 0 }),
      emit,
      now: steppingClock(10),
    });
    expect(emit.mock.calls.every(([event]: [ArenaStreamEvent]) => event.done === true)).toBe(true);
  });
});

describe('estimateOutputTokens', () => {
  it('uses ~4 characters per token and never returns 0 for real text', () => {
    expect(estimateOutputTokens('')).toBe(0);
    expect(estimateOutputTokens('ab')).toBe(1);
    expect(estimateOutputTokens('x'.repeat(40))).toBe(10);
  });
});
