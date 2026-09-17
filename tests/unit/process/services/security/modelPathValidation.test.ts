import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GGUF_MODEL_EXTENSIONS,
  isPathInsideRoots,
  validateModelFile,
  WHISPER_MODEL_EXTENSIONS,
} from '@process/services/security/modelPathValidation';

const tempRoots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-model-jail-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

const gguf = { allowedExtensions: GGUF_MODEL_EXTENSIONS };

describe('validateModelFile', () => {
  it('accepts a real .gguf file inside an allowed root', () => {
    const root = createRoot();
    const modelPath = path.join(root, 'nested', 'model.gguf');
    fs.mkdirSync(path.dirname(modelPath));
    fs.writeFileSync(modelPath, Buffer.alloc(1));

    expect(validateModelFile(modelPath, { ...gguf, allowedRoots: [root] })).toBe(fs.realpathSync(modelPath));
  });

  it('rejects a model outside every allowed root', () => {
    const root = createRoot();
    const outside = createRoot();
    const modelPath = path.join(outside, 'model.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));

    expect(() => validateModelFile(modelPath, { ...gguf, allowedRoots: [root] })).toThrow(
      'outside the configured local model directories'
    );
  });

  it('rejects a ".." traversal that escapes the root', () => {
    const root = createRoot();
    const outside = createRoot();
    fs.writeFileSync(path.join(outside, 'model.gguf'), Buffer.alloc(1));
    const traversal = path.join(root, '..', path.basename(outside), 'model.gguf');

    expect(() => validateModelFile(traversal, { ...gguf, allowedRoots: [root] })).toThrow('outside');
  });

  it('rejects a symlinked sub-directory that points out of the root', () => {
    const root = createRoot();
    const outside = createRoot();
    fs.writeFileSync(path.join(outside, 'model.gguf'), Buffer.alloc(1));
    fs.symlinkSync(outside, path.join(root, 'link'));

    expect(() => validateModelFile(path.join(root, 'link', 'model.gguf'), { ...gguf, allowedRoots: [root] })).toThrow(
      'outside'
    );
  });

  it('rejects a missing file and a directory', () => {
    const root = createRoot();
    expect(() => validateModelFile(path.join(root, 'absent.gguf'), { ...gguf, allowedRoots: [root] })).toThrow(
      'no such file'
    );
    fs.mkdirSync(path.join(root, 'dir.gguf'));
    expect(() => validateModelFile(path.join(root, 'dir.gguf'), { ...gguf, allowedRoots: [root] })).toThrow(
      'not a regular file'
    );
  });

  it('rejects a wrong extension, such as a shell script inside the root', () => {
    const root = createRoot();
    const script = path.join(root, 'x.sh');
    fs.writeFileSync(script, '#!/bin/sh\n');

    expect(() => validateModelFile(script, { ...gguf, allowedRoots: [root] })).toThrow('expected a .gguf file');
    expect(() =>
      validateModelFile(script, { allowedExtensions: WHISPER_MODEL_EXTENSIONS, allowedRoots: [root] })
    ).toThrow('expected a .bin or .gguf file');
  });

  it('accepts a whisper .bin model and uses the caller-supplied wording', () => {
    const root = createRoot();
    const modelPath = path.join(root, 'ggml-base-q5_1.bin');
    fs.writeFileSync(modelPath, Buffer.alloc(1));

    expect(validateModelFile(modelPath, { allowedRoots: [root], allowedExtensions: WHISPER_MODEL_EXTENSIONS })).toBe(
      fs.realpathSync(modelPath)
    );
    expect(() =>
      validateModelFile('/etc/hosts', {
        allowedRoots: [root],
        allowedExtensions: WHISPER_MODEL_EXTENSIONS,
        allowedDescription: 'the whisper model directory',
      })
    ).toThrow('outside the whisper model directory');
  });

  it('rejects everything when the allowed root list is empty', () => {
    const root = createRoot();
    const modelPath = path.join(root, 'model.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));

    expect(() => validateModelFile(modelPath, { ...gguf, allowedRoots: [] })).toThrow('outside');
    expect(() => validateModelFile('  ', { ...gguf, allowedRoots: [root] })).toThrow('empty model path');
  });
});

describe('isPathInsideRoots', () => {
  it('treats the root itself as not inside', () => {
    const root = createRoot();
    expect(isPathInsideRoots(root, [root])).toBe(false);
    expect(isPathInsideRoots(path.join(root, 'model.gguf'), [root])).toBe(true);
  });
});
