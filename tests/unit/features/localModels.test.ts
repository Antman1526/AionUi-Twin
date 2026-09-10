import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanLocalModelDirectories } from '../../../packages/desktop/src/process/services/localModels/LocalModelDiscoveryService';

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
});
