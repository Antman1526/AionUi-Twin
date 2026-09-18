// Target location: tests/unit/process/services/localModels/LocalModelRuntimeService.test.ts
//
// NOTE vs. the pre-existing baseline file at this path: only the import path
// was broken (it pointed at a top-level `../../../../../src/...` that no
// longer exists after the move to `packages/desktop/src`) — fixed here to
// use the `@process/` alias, matching the convention used by ~670 other
// passing test files in this repo. A `resolveExecutable` describe block was
// added at the bottom for the new executable-permission check; every other
// existing test/assertion is unchanged.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLlamaServerArgs,
  createLocalProviderFromRuntime,
  resolveExecutable,
  startManagedLlamaServer,
} from '@process/services/localModels/LocalModelRuntimeService';

describe('LocalModelRuntimeService', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  function createRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-local-runtime-'));
    tempRoots.push(root);
    return root;
  }

  it('creates an enabled no-key provider for a local OpenAI-compatible runtime', () => {
    const provider = createLocalProviderFromRuntime({
      runtime: 'llama.cpp',
      name: 'Qwen3.5-9B-Q4_K_M',
      baseUrl: 'http://localhost:18080/v1',
      models: ['Qwen3.5-9B-Q4_K_M'],
    });

    expect(provider).toMatchObject({
      name: 'Local Qwen3.5-9B-Q4_K_M',
      platform: 'custom',
      base_url: 'http://localhost:18080/v1',
      api_key: '',
      models: ['Qwen3.5-9B-Q4_K_M'],
      useModel: 'Qwen3.5-9B-Q4_K_M',
      enabled: true,
    });
    expect(provider.id).toMatch(/^local-managed-/);
  });

  it('rejects llama-server launch when the model path is outside allowed roots', async () => {
    const root = createRoot();
    const modelPath = path.join(os.tmpdir(), 'outside-model.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));

    await expect(
      startManagedLlamaServer({
        modelPath,
        allowedRoots: [root],
        executableCandidates: [],
      })
    ).rejects.toThrow('outside the configured local model directories');

    fs.rmSync(modelPath, { force: true });
  });

  it('fails promptly when the llama-server executable cannot launch', async () => {
    const root = createRoot();
    const modelPath = path.join(root, 'model.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));

    const startedAt = Date.now();
    await expect(
      startManagedLlamaServer({
        modelPath,
        allowedRoots: [root],
        executableCandidates: ['aionui-definitely-missing-llama-server'],
        readinessTimeoutMs: 60_000,
      })
    ).rejects.toThrow('Failed to launch llama-server');
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('adds reasoning flags only when the model runtime option is set', () => {
    const base = {
      modelPath: '/models/qwen.gguf',
      port: 18181,
      alias: 'qwen',
      contextSize: 4096,
      gpuLayers: 99,
    };

    expect(buildLlamaServerArgs(base)).not.toContain('--reasoning');
    expect(buildLlamaServerArgs({ ...base, reasoning: 'off' })).toEqual(expect.arrayContaining(['--reasoning', 'off']));
  });

  describe('resolveExecutable', () => {
    it('prefers a concrete path candidate that exists and is executable', () => {
      const result = resolveExecutable(['/opt/homebrew/bin/llama-server', 'llama-server'], {
        exists: (p) => p === '/opt/homebrew/bin/llama-server',
        isExecutable: (p) => p === '/opt/homebrew/bin/llama-server',
      });
      expect(result).toBe('/opt/homebrew/bin/llama-server');
    });

    it('skips a path candidate that exists but is not executable, falling through to the next', () => {
      const result = resolveExecutable(['/usr/local/bin/llama-server', '/opt/homebrew/bin/llama-server'], {
        exists: () => true,
        // The first candidate exists but fails the execute-permission check.
        isExecutable: (p) => p !== '/usr/local/bin/llama-server',
      });
      expect(result).toBe('/opt/homebrew/bin/llama-server');
    });

    it('falls back to a bare command name when no path candidate is usable', () => {
      const result = resolveExecutable(['/usr/local/bin/llama-server', 'llama-server'], {
        exists: () => true,
        isExecutable: () => false,
      });
      expect(result).toBe('llama-server');
    });

    it('returns null when nothing is usable and there is no bare-command fallback', () => {
      const result = resolveExecutable(['/usr/local/bin/llama-server'], {
        exists: () => true,
        isExecutable: () => false,
      });
      expect(result).toBeNull();
    });
  });
});
