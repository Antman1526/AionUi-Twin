/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sandbox worker must be created with V8 heap limits, so a runaway
 * extension is killed by V8 instead of exhausting the machine's memory.
 * `worker_threads` is mocked to capture the constructor options.
 */

const created = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock('worker_threads', async () => {
  const { EventEmitter } = await vi.importActual<typeof import('node:events')>('node:events');
  class FakeWorker extends EventEmitter {
    constructor(_script: string, options: Record<string, unknown>) {
      super();
      created.options.push(options);
      // Report ready once the host has attached its listeners.
      setImmediate(() => this.emit('message', { type: 'ready' }));
    }
    postMessage(): void {}
    terminate(): Promise<number> {
      return Promise.resolve(0);
    }
  }
  return { Worker: FakeWorker };
});

import { SandboxHost, SANDBOX_RESOURCE_LIMITS } from '../../../../src/process/extensions/sandbox/sandbox';

beforeEach(() => {
  created.options = [];
});

describe('extensions/sandbox SandboxHost — worker resource limits', () => {
  it('passes V8 heap limits when creating the worker', async () => {
    const host = new SandboxHost({
      extensionName: 'limits-ext',
      extensionDir: '/tmp/limits-ext',
      entryPoint: 'main.js',
      permissions: undefined,
    });

    await host.start();

    expect(created.options).toHaveLength(1);
    expect(created.options[0].resourceLimits).toEqual(SANDBOX_RESOURCE_LIMITS);
    expect(SANDBOX_RESOURCE_LIMITS).toEqual({ maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 });

    await host.stop();
  });

  it('still restricts execArgv', async () => {
    const host = new SandboxHost({
      extensionName: 'limits-ext-2',
      extensionDir: '/tmp/limits-ext-2',
      entryPoint: 'main.js',
      permissions: undefined,
    });

    await host.start();

    expect(created.options[0].execArgv).toEqual([]);

    await host.stop();
  });
});
