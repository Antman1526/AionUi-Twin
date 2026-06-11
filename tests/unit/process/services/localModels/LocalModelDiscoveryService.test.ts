import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_MODEL_SCAN_MAX_DEPTH,
  scanLocalModelDirectories,
} from '../../../../../src/process/services/localModels/LocalModelDiscoveryService';

describe('LocalModelDiscoveryService', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  function createRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-local-models-'));
    tempRoots.push(root);
    return root;
  }

  function writeFile(root: string, relativePath: string, bytes: number): string {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.alloc(bytes, 1));
    return target;
  }

  it('discovers supported local model assets and ignores macOS metadata files', async () => {
    const root = createRoot();
    const ggufPath = writeFile(root, 'GGUF/Qwen3.5-9B-Q4_K_M.gguf', 16);
    const sttPath = writeFile(root, 'STT/ggml-base.en.bin', 8);
    const ttsPath = writeFile(root, 'TTS/en_US-amy-medium.onnx', 4);
    writeFile(root, 'GGUF/._Qwen3.5-9B-Q4_K_M.gguf', 32);
    writeFile(root, '.DS_Store', 32);
    writeFile(root, 'logs/download.log', 32);

    const result = await scanLocalModelDirectories({ roots: [root] });

    expect(result.roots).toEqual([{ path: root, exists: true }]);
    expect(result.models).toHaveLength(3);
    expect(result.models.map((model) => model.path).toSorted()).toEqual([ggufPath, sttPath, ttsPath].toSorted());
    expect(result.models.find((model) => model.path === ggufPath)).toMatchObject({
      kind: 'llm',
      format: 'gguf',
      name: 'Qwen3.5-9B-Q4_K_M',
      suggestedRuntime: 'llama.cpp',
      sizeBytes: 16,
    });
    expect(result.models.find((model) => model.path === sttPath)).toMatchObject({
      kind: 'stt',
      format: 'bin',
      suggestedRuntime: 'whisper.cpp',
    });
    expect(result.models.find((model) => model.path === ttsPath)).toMatchObject({
      kind: 'tts',
      format: 'onnx',
      suggestedRuntime: 'piper',
    });
  });

  it('reports missing roots without failing the scan', async () => {
    const root = createRoot();
    const missingRoot = path.join(root, 'missing');

    const result = await scanLocalModelDirectories({ roots: [missingRoot] });

    expect(result.roots).toEqual([{ path: missingRoot, exists: false }]);
    expect(result.models).toEqual([]);
  });

  it('stops recursive discovery after the configured depth limit', async () => {
    const root = createRoot();
    const tooDeepPath = Array.from({ length: LOCAL_MODEL_SCAN_MAX_DEPTH + 1 }, (_, index) => `level-${index}`).join(
      path.sep
    );
    writeFile(root, path.join(tooDeepPath, 'too-deep.gguf'), 16);

    const result = await scanLocalModelDirectories({ roots: [root] });

    expect(result.roots).toEqual([{ path: root, exists: true }]);
    expect(result.models).toEqual([]);
  });
});
