import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanLocalModelDirectories } from '../../../packages/desktop/src/process/services/localModels/LocalModelDiscoveryService';
import { expandHomeDirectory } from '../../../packages/desktop/src/process/services/localModels/defaultModelDirectories';

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
