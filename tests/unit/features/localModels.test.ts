import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanLocalModelDirectories } from '../../../packages/desktop/src/process/services/localModels/LocalModelDiscoveryService';
import { expandHomeDirectory } from '../../../packages/desktop/src/process/services/localModels/defaultModelDirectories';
import {
  buildMlxServerArgs,
  createLocalProviderFromRuntime,
  isManagedLocalProvider,
  replaceManagedProvider,
} from '../../../packages/desktop/src/process/services/localModels/LocalModelRuntimeService';

describe('LocalModelDiscoveryService', () => {
  it('discovers both GGUF files and Apple Silicon native MLX bundles', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-models-test-'));

    try {
      // 1. Create mock GGUF model
      const ggufPath = path.join(tmpDir, 'test-model-q4.gguf');
      await fs.writeFile(ggufPath, Buffer.alloc(1024 * 1024)); // 1MB

      // 2. Create mock MLX bundle directory
      const mlxDir = path.join(tmpDir, 'mlx', 'mlx-community--Qwen2.5-7B-4bit');
      await fs.mkdir(mlxDir, { recursive: true });
      await fs.writeFile(path.join(mlxDir, 'config.json'), '{"model_type":"qwen2"}');
      await fs.writeFile(path.join(mlxDir, 'tokenizer.json'), '{}');
      await fs.writeFile(path.join(mlxDir, 'model.safetensors'), Buffer.alloc(2 * 1024 * 1024)); // 2MB

      const result = await scanLocalModelDirectories({ roots: [tmpDir] });
      expect(result.models.length).toBeGreaterThanOrEqual(2);

      const ggufAsset = result.models.find((m) => m.format === 'gguf');
      expect(ggufAsset).toBeDefined();
      expect(ggufAsset?.kind).toBe('llm');
      expect(ggufAsset?.suggestedRuntime).toBe('llama.cpp');

      const mlxAsset = result.models.find((m) => m.format === 'mlx');
      expect(mlxAsset).toBeDefined();
      expect(mlxAsset?.kind).toBe('llm');
      expect(mlxAsset?.suggestedRuntime).toBe('mlx');
      expect(mlxAsset?.sizeBytes).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('discovers an MLX bundle when the root itself is the model directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-mlx-direct-test-'));

    try {
      await fs.writeFile(path.join(tmpDir, 'config.json'), '{"model_type":"llama"}');
      await fs.writeFile(path.join(tmpDir, 'model.safetensors'), Buffer.alloc(1024 * 1024));

      const result = await scanLocalModelDirectories({ roots: [tmpDir] });
      expect(result.models.length).toBe(1);
      expect(result.models[0]?.format).toBe('mlx');
      expect(result.models[0]?.path).toBe(tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('discovers all models when GGUF and MLX sit in the same location alongside venvs, non-model files and symlinks', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-unified-location-test-'));

    try {
      // Create non-model directories that should be skipped (e.g. venv, cache)
      const venvDir = path.join(tmpDir, '.mlx_lm_venv', 'lib');
      await fs.mkdir(venvDir, { recursive: true });
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(venvDir, `file_${i}.py`), 'print("venv")');
      }

      // Create GGUF in root
      await fs.writeFile(path.join(tmpDir, 'Llama-3.2-3B.gguf'), Buffer.alloc(1024 * 512));

      // Create GGUF in subfolder (e.g. repo folder)
      const repoDir = path.join(tmpDir, 'Author__Repo-Model-GGUF');
      await fs.mkdir(repoDir, { recursive: true });
      await fs.writeFile(path.join(repoDir, 'model.gguf'), Buffer.alloc(1024 * 512));

      // Create MLX bundle directly in same location
      const mlxDir = path.join(tmpDir, 'Qwen-MLX-4bit');
      await fs.mkdir(mlxDir, { recursive: true });
      await fs.writeFile(path.join(mlxDir, 'config.json'), '{"model_type":"qwen"}');
      await fs.writeFile(path.join(mlxDir, 'weights.safetensors'), Buffer.alloc(1024 * 512));

      // Create a symlinked directory containing another model
      const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-external-target-'));
      await fs.writeFile(path.join(externalDir, 'symlinked-model.gguf'), Buffer.alloc(1024 * 512));
      await fs.symlink(externalDir, path.join(tmpDir, 'SymlinkedFolder'));

      const result = await scanLocalModelDirectories({ roots: [tmpDir] });
      expect(result.models.length).toBe(4);

      const formats = result.models.map((m) => m.format).toSorted();
      expect(formats).toEqual(['gguf', 'gguf', 'gguf', 'mlx']);

      await fs.rm(externalDir, { recursive: true, force: true });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('expandHomeDirectory', () => {
  it('expands ~ and ~/ paths correctly to home directory', () => {
    const home = os.homedir();
    expect(expandHomeDirectory('~')).toBe(home);
    expect(expandHomeDirectory('~/my-models')).toBe(path.join(home, 'my-models'));
    expect(expandHomeDirectory('~/AI/models/')).toBe(path.join(home, 'AI', 'models'));
    expect(expandHomeDirectory('/Volumes/External/Models')).toBe('/Volumes/External/Models');
    expect(expandHomeDirectory('')).toBe('');
  });
});

describe('buildMlxServerArgs', () => {
  it('constructs correct CLI flags for mlx_lm.server', () => {
    const args = buildMlxServerArgs({
      modelPath: '/path/to/mlx-model',
      port: 8080,
      contextSize: 8192,
      reasoning: 'off',
    });

    expect(args).toContain('--model');
    expect(args).toContain('/path/to/mlx-model');
    expect(args).toContain('--host');
    expect(args).toContain('127.0.0.1');
    expect(args).toContain('--port');
    expect(args).toContain('8080');
    expect(args).toContain('--trust-remote-code');
    expect(args).toContain('--max-tokens');
    expect(args).toContain('8192');
    expect(args).toContain('--chat-template-args');
    expect(args).toContain('{"enable_thinking":false}');
  });
});

describe('Managed Local Provider Lifecycle', () => {
  it('correctly identifies managed local providers across runtimes', () => {
    expect(isManagedLocalProvider('local-llama-cpp-123')).toBe(true);
    expect(isManagedLocalProvider('local-mlx-456')).toBe(true);
    expect(isManagedLocalProvider('local-managed-mlx-789')).toBe(true);
    expect(isManagedLocalProvider('local-managed-llama-cpp-abc')).toBe(true);
    expect(isManagedLocalProvider('custom-openai-provider')).toBe(false);
    expect(isManagedLocalProvider('gemini-official')).toBe(false);
    expect(isManagedLocalProvider(undefined)).toBe(false);
  });

  it('creates distinctive provider labels and IDs for MLX vs GGUF', () => {
    const mlxProvider = createLocalProviderFromRuntime({
      runtime: 'mlx',
      name: 'Qwen2.5-7B-4bit',
      baseUrl: 'http://127.0.0.1:8080/v1',
      models: ['Qwen2.5-7B-4bit'],
    });
    expect(mlxProvider.name).toBe('Local MLX Qwen2.5-7B-4bit');
    expect(mlxProvider.id).toContain('local-managed-mlx-');
    expect(mlxProvider.models).toEqual(['Qwen2.5-7B-4bit']);
    expect(mlxProvider.enabled).toBe(true);

    const ggufProvider = createLocalProviderFromRuntime({
      runtime: 'llama.cpp',
      name: 'Llama-3.2-3B',
      baseUrl: 'http://127.0.0.1:8081/v1',
      models: ['Llama-3.2-3B'],
    });
    expect(ggufProvider.name).toBe('Local Llama-3.2-3B');
    expect(ggufProvider.id).toContain('local-managed-llama-cpp-');
  });

  it('replaces managed providers cleanly while preserving user providers', () => {
    const userProvider = {
      id: 'custom-openai-user',
      name: 'My OpenAI',
      platform: 'custom' as const,
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      models: ['gpt-4o'],
      enabled: true,
    };
    const oldManaged = {
      id: 'local-managed-llama-cpp-old',
      name: 'Local Old GGUF',
      platform: 'custom' as const,
      base_url: 'http://127.0.0.1:8080/v1',
      api_key: '',
      models: ['old-model'],
      enabled: true,
    };
    const newMlxManaged = {
      id: 'local-managed-mlx-new',
      name: 'Local MLX New',
      platform: 'custom' as const,
      base_url: 'http://127.0.0.1:8082/v1',
      api_key: '',
      models: ['new-mlx-model'],
      enabled: true,
    };

    const initialList = [userProvider, oldManaged];
    const updated = replaceManagedProvider(initialList, newMlxManaged);

    expect(updated.length).toBe(2);
    expect(updated).toContain(userProvider);
    expect(updated).toContain(newMlxManaged);
    expect(updated.find((p) => p.id === 'local-managed-llama-cpp-old')).toBeUndefined();

    const stopped = replaceManagedProvider(updated, null);
    expect(stopped.length).toBe(1);
    expect(stopped[0]?.id).toBe('custom-openai-user');
  });
});
