import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLlamaServerArgs,
  createLocalProviderFromRuntime,
  startManagedLlamaServer,
} from '../../../../../src/process/services/localModels/LocalModelRuntimeService';

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
      baseUrl: 'http://localhost:18080/v1',
      apiKey: '',
      model: ['Qwen3.5-9B-Q4_K_M'],
      useModel: 'Qwen3.5-9B-Q4_K_M',
      enabled: true,
    });
    expect(provider.id).toMatch(/^local-llama-cpp-/);
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
});
