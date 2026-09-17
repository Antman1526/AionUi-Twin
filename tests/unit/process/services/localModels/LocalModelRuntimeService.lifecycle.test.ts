import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLlamaServerArgs,
  getManagedServerStatus,
  startManagedLlamaServer,
  stopManagedLlamaServer,
  type ManagedServerExit,
} from '@process/services/localModels/LocalModelRuntimeService';

/**
 * Stand-in for a spawned llama-server: answers /health on the port it was given
 * so the real readiness probe succeeds, and lets the test drive its exit.
 */
class FakeChild extends EventEmitter {
  pid = 4242;
  stderr = new Readable({ read: () => undefined });
  killed = false;
  readonly health: http.Server | null;

  /** `port: null` means the process never serves /health, so it can never become ready. */
  constructor(port: number | null) {
    super();
    if (port === null) {
      this.health = null;
      return;
    }
    this.health = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('{"status":"ok"}');
    });
    this.health.listen(port, '127.0.0.1');
  }

  writeStderr(text: string): void {
    this.stderr.push(text);
  }

  kill(): boolean {
    this.killed = true;
    this.exitWith(null, 'SIGTERM');
    return true;
  }

  exitWith(code: number | null, signal: NodeJS.Signals | null): void {
    this.health?.close();
    this.emit('exit', code, signal);
  }
}

const children: FakeChild[] = [];

function fakeSpawn(): typeof nodeSpawn {
  return ((_command: string, args: readonly string[]) => {
    const port = Number(args[args.indexOf('--port') + 1]);
    const child = new FakeChild(port);
    children.push(child);
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;
}

const tempRoots: string[] = [];

function createModel(): { root: string; modelPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-runtime-lifecycle-'));
  tempRoots.push(root);
  const modelPath = path.join(root, 'model.gguf');
  fs.writeFileSync(modelPath, Buffer.alloc(1));
  return { root, modelPath };
}

afterEach(() => {
  stopManagedLlamaServer();
  for (const child of children) child.health?.close();
  children.length = 0;
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

describe('buildLlamaServerArgs', () => {
  const base = { modelPath: '/models/qwen.gguf', port: 18181, alias: 'qwen', contextSize: 4096, gpuLayers: 99 };

  it('omits --embedding unless the option is enabled', () => {
    expect(buildLlamaServerArgs(base)).not.toContain('--embedding');
    expect(buildLlamaServerArgs({ ...base, embedding: false })).not.toContain('--embedding');
  });

  it('adds --embedding when the option is enabled', () => {
    expect(buildLlamaServerArgs({ ...base, embedding: true })).toContain('--embedding');
  });
});

describe('managed llama-server exit reporting', () => {
  it('reports an unexpected exit as a crash, with the exit code and stderr tail', async () => {
    const { root, modelPath } = createModel();
    const onExit = vi.fn<(exit: ManagedServerExit) => void>();

    const handle = await startManagedLlamaServer({
      modelPath,
      allowedRoots: [root],
      executableCandidates: ['llama-server'],
      spawnFn: fakeSpawn(),
      onExit,
    });
    expect(handle.modelPath).toBe(modelPath);
    expect(getManagedServerStatus()).not.toBeNull();

    const child = children.at(-1)!;
    child.writeStderr('ggml_metal_init: failed to allocate buffer\n');
    await vi.waitFor(() => expect(onExit).not.toHaveBeenCalled());
    child.exitWith(1, null);

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(onExit.mock.calls[0][0]).toMatchObject({
      expected: false,
      modelPath,
      exitCode: 1,
      signal: null,
    });
    expect(onExit.mock.calls[0][0].stderrTail).toContain('failed to allocate buffer');
    expect(getManagedServerStatus()).toBeNull();
  });

  it('reports an exit requested through stopManagedLlamaServer as expected', async () => {
    const { root, modelPath } = createModel();
    const onExit = vi.fn<(exit: ManagedServerExit) => void>();

    await startManagedLlamaServer({
      modelPath,
      allowedRoots: [root],
      executableCandidates: ['llama-server'],
      spawnFn: fakeSpawn(),
      onExit,
    });

    stopManagedLlamaServer();

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(onExit.mock.calls[0][0]).toMatchObject({ expected: true, modelPath });
    expect(getManagedServerStatus()).toBeNull();
  });

  it('does not report an exit that happens before the server became healthy', async () => {
    const { root, modelPath } = createModel();
    const onExit = vi.fn<(exit: ManagedServerExit) => void>();

    const failingSpawn = (() => {
      const child = new FakeChild(null);
      children.push(child);
      setTimeout(() => child.exitWith(2, null), 0);
      return child as unknown as ChildProcess;
    }) as unknown as typeof nodeSpawn;

    await expect(
      startManagedLlamaServer({
        modelPath,
        allowedRoots: [root],
        executableCandidates: ['llama-server'],
        spawnFn: failingSpawn,
        onExit,
      })
    ).rejects.toThrow('llama-server exited before becoming healthy');

    expect(onExit).not.toHaveBeenCalled();
  });

  it('passes --embedding through to the spawned process when requested', async () => {
    const { root, modelPath } = createModel();
    const spawnSpy = vi.fn(fakeSpawn());

    await startManagedLlamaServer({
      modelPath,
      allowedRoots: [root],
      executableCandidates: ['llama-server'],
      spawnFn: spawnSpy as unknown as typeof nodeSpawn,
      embedding: true,
    });

    expect(spawnSpy.mock.calls[0][1]).toContain('--embedding');
  });
});
