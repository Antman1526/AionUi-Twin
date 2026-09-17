import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEmbeddingServerArgs, startEmbeddingRuntime } from '@process/services/semanticSearch/EmbeddingRuntime';

const tempRoots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-embedding-runtime-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

describe('startEmbeddingRuntime model jail', () => {
  it('refuses a model outside the allowed roots without spawning anything', async () => {
    const root = createRoot();
    const outside = createRoot();
    const modelPath = path.join(outside, 'embedding.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));
    const spawnFn = vi.fn();

    await expect(
      startEmbeddingRuntime({
        modelPath,
        allowedRoots: [root],
        spawnFn: spawnFn as never,
      })
    ).rejects.toThrow('outside the configured local model directories');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('refuses a non-gguf file inside an allowed root', async () => {
    const root = createRoot();
    const script = path.join(root, 'x.sh');
    fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o755 });
    const spawnFn = vi.fn();

    await expect(
      startEmbeddingRuntime({ modelPath: script, allowedRoots: [root], spawnFn: spawnFn as never })
    ).rejects.toThrow('expected a .gguf file');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('refuses a configured executable that is not llama-server', async () => {
    const root = createRoot();
    const modelPath = path.join(root, 'embedding.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));
    // Fail fast instead of leaving a real child process behind if one is spawned.
    const spawnFn = vi.fn(() => {
      throw new Error('spawn-attempted');
    });

    // `/bin/bash` must never reach spawn: the resolver drops the configured path,
    // so the call either finds a real llama-server or reports none installed.
    await expect(
      startEmbeddingRuntime({
        modelPath,
        allowedRoots: [root],
        executablePath: '/bin/bash',
        spawnFn: spawnFn as never,
      })
    ).rejects.toThrow();
    expect(spawnFn.mock.calls.map((args) => args[0])).not.toContain('/bin/bash');
  });
});

describe('buildEmbeddingServerArgs', () => {
  it('passes the model path and --embedding through', () => {
    expect(buildEmbeddingServerArgs({ modelPath: '/models/e.gguf', port: 8123 })).toEqual(
      expect.arrayContaining(['-m', '/models/e.gguf', '--embedding'])
    );
  });
});
