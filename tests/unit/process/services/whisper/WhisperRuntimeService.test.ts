import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildWhisperServerArgs,
  getWhisperModelsDirectory,
  startManagedWhisperServer,
} from '@process/services/whisper/WhisperRuntimeService';

describe('buildWhisperServerArgs', () => {
  it('builds the minimal model/host/port arguments', () => {
    expect(buildWhisperServerArgs({ modelPath: '/models/ggml-base-q5_1.bin', port: 8123 })).toEqual([
      '-m',
      '/models/ggml-base-q5_1.bin',
      '--host',
      '127.0.0.1',
      '--port',
      '8123',
    ]);
  });

  it('honors a custom host', () => {
    const args = buildWhisperServerArgs({ modelPath: '/models/m.bin', port: 8123, host: '0.0.0.0' });
    expect(args).toContain('--host');
    expect(args[args.indexOf('--host') + 1]).toBe('0.0.0.0');
  });

  it('appends -l/--language only when a language is given', () => {
    const withLanguage = buildWhisperServerArgs({ modelPath: '/models/m.bin', port: 8123, language: 'en' });
    expect(withLanguage).toEqual(['-m', '/models/m.bin', '--host', '127.0.0.1', '--port', '8123', '-l', 'en']);

    const withoutLanguage = buildWhisperServerArgs({ modelPath: '/models/m.bin', port: 8123 });
    expect(withoutLanguage).not.toContain('-l');
  });
});

const tempRoots: string[] = [];

function createUserData(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-whisper-jail-'));
  tempRoots.push(root);
  const modelsDirectory = getWhisperModelsDirectory(root);
  fs.mkdirSync(modelsDirectory, { recursive: true });
  return modelsDirectory;
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

describe('startManagedWhisperServer model jail', () => {
  it('refuses a model outside the whisper model directory', async () => {
    const modelsDirectory = createUserData();

    await expect(
      startManagedWhisperServer({ modelPath: '/etc/hosts', allowedRoots: [modelsDirectory] })
    ).rejects.toThrow('outside the whisper model directory');
  });

  it('refuses a model file that does not exist in the whisper model directory', async () => {
    const modelsDirectory = createUserData();

    await expect(
      startManagedWhisperServer({
        modelPath: path.join(modelsDirectory, 'ggml-base-q5_1.bin'),
        allowedRoots: [modelsDirectory],
      })
    ).rejects.toThrow('no such file');
  });

  it('refuses a file with an extension that is not a whisper model', async () => {
    const modelsDirectory = createUserData();
    const script = path.join(modelsDirectory, 'x.sh');
    fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o755 });

    await expect(startManagedWhisperServer({ modelPath: script, allowedRoots: [modelsDirectory] })).rejects.toThrow(
      'expected a .bin or .gguf file'
    );
  });
});
