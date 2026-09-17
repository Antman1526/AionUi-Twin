import { describe, expect, it, vi } from 'vitest';
import type { ArenaStreamEvent } from '@/common/adapter/ipcBridge';
import { runArena, type ArenaChatClient } from '@process/services/arena/runArena';

type Deferred = {
  client: ArenaChatClient;
  resolve: (content: string, completionTokens?: number) => void;
  reject: (error: Error) => void;
  calls: number;
};

/** A client whose single completion is resolved by the test. */
function deferredClient(): Deferred {
  const state = {
    resolve: (_content: string, _tokens?: number): void => undefined,
    reject: (_e: Error): void => undefined,
    calls: 0,
  };
  const client: ArenaChatClient = {
    createChatCompletion: () => {
      state.calls += 1;
      return new Promise((resolve, reject) => {
        state.resolve = (content, completionTokens) =>
          resolve({
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: 'm',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            ...(completionTokens === undefined
              ? {}
              : {
                  usage: { prompt_tokens: 1, completion_tokens: completionTokens, total_tokens: 1 + completionTokens },
                }),
          });
        state.reject = reject;
      });
    },
  };
  return {
    client,
    get calls() {
      return state.calls;
    },
    resolve: (content, tokens) => state.resolve(content, tokens),
    reject: (error) => state.reject(error),
  } as Deferred;
}

const REQUEST = {
  runId: 'run-1',
  left: { providerId: 'p1', model: 'a' },
  right: { providerId: 'p2', model: 'b' },
  prompt: 'hello',
};

/** A clock that advances by `step` ms on every read. */
function clock(step: number): () => number {
  let value = 0;
  return () => {
    const current = value;
    value += step;
    return current;
  };
}

describe('runArena', () => {
  it('puts both sides in flight before either answers', async () => {
    const left = deferredClient();
    const right = deferredClient();
    const events: ArenaStreamEvent[] = [];
    const run = runArena(REQUEST, {
      createClient: (ref) => Promise.resolve(ref.providerId === 'p1' ? left.client : right.client),
      emit: (event) => events.push(event),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(left.calls).toBe(1);
    expect(right.calls).toBe(1);
    expect(events).toHaveLength(0);

    left.resolve('L', 1);
    right.resolve('R', 1);
    await run.completed;
  });

  it('reports the answer and per-side stats from the usage block', async () => {
    const left = deferredClient();
    const right = deferredClient();
    const events: ArenaStreamEvent[] = [];
    const run = runArena(REQUEST, {
      createClient: (ref) => Promise.resolve(ref.providerId === 'p1' ? left.client : right.client),
      emit: (event) => events.push(event),
      now: clock(500),
    });

    await Promise.resolve();
    left.resolve('left answer', 50);
    right.resolve('right answer', 10);
    await run.completed;

    const leftDone = events.find((event) => event.side === 'left' && event.done);
    expect(events.find((event) => event.side === 'left' && event.delta)?.delta).toBe('left answer');
    expect(leftDone?.stats).toMatchObject({ outputTokens: 50, estimated: false });
    expect(leftDone?.stats?.ttfbMs).toBe(leftDone?.stats?.totalMs);
    expect(leftDone?.stats?.tokensPerSecond).toBeGreaterThan(0);
  });

  it('estimates token counts when the provider returns no usage', async () => {
    const left = deferredClient();
    const right = deferredClient();
    const events: ArenaStreamEvent[] = [];
    const run = runArena(REQUEST, {
      createClient: (ref) => Promise.resolve(ref.providerId === 'p1' ? left.client : right.client),
      emit: (event) => events.push(event),
      now: clock(1000),
    });

    await Promise.resolve();
    left.resolve('12345678');
    right.resolve('');
    await run.completed;

    expect(events.find((event) => event.side === 'left' && event.done)?.stats).toMatchObject({
      outputTokens: 2,
      estimated: true,
    });
  });

  it('keeps the other side running when one side fails', async () => {
    const left = deferredClient();
    const right = deferredClient();
    const events: ArenaStreamEvent[] = [];
    const run = runArena(REQUEST, {
      createClient: (ref) => Promise.resolve(ref.providerId === 'p1' ? left.client : right.client),
      emit: (event) => events.push(event),
    });

    await Promise.resolve();
    left.reject(new Error('rate limited'));
    right.resolve('survivor', 3);
    await run.completed;

    expect(events.find((event) => event.side === 'left' && event.done)?.error).toBe('rate limited');
    expect(events.find((event) => event.side === 'right' && event.done)?.stats?.outputTokens).toBe(3);
    expect(events.find((event) => event.side === 'right' && event.delta)?.delta).toBe('survivor');
  });

  it('reports a provider that cannot be built as that side failing', async () => {
    const right = deferredClient();
    const events: ArenaStreamEvent[] = [];
    const run = runArena(REQUEST, {
      createClient: (ref) =>
        ref.providerId === 'p1' ? Promise.reject(new Error('Provider not found: p1')) : Promise.resolve(right.client),
      emit: (event) => events.push(event),
    });

    await Promise.resolve();
    right.resolve('ok', 1);
    await run.completed;

    expect(events.find((event) => event.side === 'left' && event.done)?.error).toBe('Provider not found: p1');
    expect(events.find((event) => event.side === 'right' && event.done)?.error).toBeUndefined();
  });

  it('cancels both sides once and ignores answers that arrive afterwards', async () => {
    const left = deferredClient();
    const right = deferredClient();
    const events: ArenaStreamEvent[] = [];
    const run = runArena(REQUEST, {
      createClient: (ref) => Promise.resolve(ref.providerId === 'p1' ? left.client : right.client),
      emit: (event) => events.push(event),
    });

    await Promise.resolve();
    run.cancel();
    left.resolve('too late', 5);
    right.reject(new Error('aborted'));
    await run.completed;

    const terminal = events.filter((event) => event.done);
    expect(terminal).toHaveLength(2);
    expect(terminal.every((event) => event.error === 'cancelled')).toBe(true);
    expect(events.filter((event) => event.delta)).toHaveLength(0);
  });

  it('passes an abort signal through to the client', async () => {
    const createChatCompletion = vi.fn(
      (_params: unknown, options?: { signal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const run = runArena(REQUEST, {
      createClient: () => Promise.resolve({ createChatCompletion } as unknown as ArenaChatClient),
      emit: () => undefined,
    });

    await Promise.resolve();
    run.cancel();
    await run.completed;
    expect(createChatCompletion.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
