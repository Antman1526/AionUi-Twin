/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Target location: tests/unit/process/services/localModels/LocalModelRuntimeService.crashSignal.test.ts
//
// Verifies that an unexpected child exit emits a `crashed` runtimeChanged
// event (with the captured stderr tail) while a requested stop emits
// `stopped` — using an injected fake `spawn` and a stubbed `node:http` so no
// real llama-server process or network probing is involved.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  stderr = Object.assign(new EventEmitter(), { setEncoding: (_enc: string) => {} });
  kill = vi.fn();
}

let fakeChild: FakeChildProcess;
const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('node:http', () => ({
  default: {
    get: (_options: unknown, cb: (res: unknown) => void) => {
      const res = new EventEmitter() as EventEmitter & { statusCode?: number; resume?: () => void };
      res.statusCode = 200;
      res.resume = () => {};
      queueMicrotask(() => cb(res));
      const req = new EventEmitter() as EventEmitter & { destroy?: () => void };
      req.destroy = () => {};
      return req;
    },
  },
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({}),
}));

const runtimeChangedEmit = vi.fn();
vi.mock('@/common', () => ({
  ipcBridge: {
    localModel: {
      runtimeChanged: { emit: (...args: unknown[]) => runtimeChangedEmit(...args), on: vi.fn() },
    },
  },
}));

describe('LocalModelRuntimeService crash/stop signal', () => {
  let root: string;
  let modelPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeChild = new FakeChildProcess();
    spawnMock.mockReturnValue(fakeChild);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-crash-signal-'));
    modelPath = path.join(root, 'model.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('emits a crashed event with the stderr tail on an unexpected exit', async () => {
    const { startManagedLlamaServer } = await import('@process/services/localModels/LocalModelRuntimeService');

    await startManagedLlamaServer({
      modelPath,
      allowedRoots: [root],
      executableCandidates: ['fake-llama-server'],
    });

    runtimeChangedEmit.mockClear();
    fakeChild.stderr.emit('data', 'segmentation fault\n');
    fakeChild.emit('exit', 139, null);

    expect(runtimeChangedEmit).toHaveBeenCalledTimes(1);
    const [event] = runtimeChangedEmit.mock.calls[0] as [Record<string, unknown>];
    expect(event).toMatchObject({
      status: 'crashed',
      modelPath,
      exitCode: 139,
    });
    expect(event.stderrTail).toContain('segmentation fault');
  });

  it('emits a stopped event (no stderr tail) when the exit was requested via stopManagedLlamaServer', async () => {
    const { startManagedLlamaServer, stopManagedLlamaServer } =
      await import('@process/services/localModels/LocalModelRuntimeService');

    await startManagedLlamaServer({
      modelPath,
      allowedRoots: [root],
      executableCandidates: ['fake-llama-server'],
    });

    runtimeChangedEmit.mockClear();
    stopManagedLlamaServer();
    fakeChild.emit('exit', null, 'SIGTERM');

    expect(runtimeChangedEmit).toHaveBeenCalledTimes(1);
    const [event] = runtimeChangedEmit.mock.calls[0] as [Record<string, unknown>];
    expect(event).toMatchObject({
      status: 'stopped',
      modelPath,
      signal: 'SIGTERM',
    });
    expect(event.stderrTail).toBeUndefined();
  });
});
