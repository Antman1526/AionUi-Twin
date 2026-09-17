import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isValidExecutablePath,
  LLAMA_SERVER_BASENAMES,
  validateExecutablePath,
  WHISPER_SERVER_BASENAMES,
} from '@process/services/security/executableValidation';

const tempRoots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-exec-validation-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

const llama = { allowedBasenames: LLAMA_SERVER_BASENAMES };

describe('validateExecutablePath', () => {
  it('accepts a real llama-server-named executable', () => {
    const root = createRoot();
    const executable = path.join(root, 'llama-server');
    fs.writeFileSync(executable, '#!/bin/sh\n', { mode: 0o755 });

    expect(validateExecutablePath(executable, llama)).toBe(path.resolve(executable));
  });

  it('rejects an arbitrary system binary such as /bin/bash', () => {
    expect(() => validateExecutablePath('/bin/bash', llama)).toThrow('only llama-server');
    expect(isValidExecutablePath('/bin/bash', llama)).toBe(false);
  });

  it('rejects a wrong basename even when the file exists and is executable', () => {
    const root = createRoot();
    const executable = path.join(root, 'whisper-server');
    fs.writeFileSync(executable, '#!/bin/sh\n', { mode: 0o755 });

    expect(() => validateExecutablePath(executable, llama)).toThrow('only llama-server');
    expect(isValidExecutablePath(executable, { allowedBasenames: WHISPER_SERVER_BASENAMES })).toBe(true);
  });

  it('rejects a directory that happens to be named like the binary', () => {
    const root = createRoot();
    const directory = path.join(root, 'llama-server');
    fs.mkdirSync(directory);

    expect(() => validateExecutablePath(directory, llama)).toThrow('not a regular file');
  });

  it('rejects a file without the executable bit on non-Windows platforms', () => {
    const root = createRoot();
    const executable = path.join(root, 'llama-server');
    fs.writeFileSync(executable, 'not executable', { mode: 0o644 });

    expect(() => validateExecutablePath(executable, { ...llama, platform: 'darwin' })).toThrow('not executable');
    // Windows has no executable bit, so the same file passes there.
    expect(isValidExecutablePath(executable, { ...llama, platform: 'win32' })).toBe(true);
  });

  it('rejects a missing file and an empty path', () => {
    const root = createRoot();
    expect(() => validateExecutablePath(path.join(root, 'llama-server'), llama)).toThrow('no such file');
    expect(() => validateExecutablePath('   ', llama)).toThrow('empty executable path');
  });

  it('accepts the .exe basename, so the Windows binary name is not rejected', () => {
    const root = createRoot();
    const executable = path.join(root, 'llama-server.exe');
    fs.writeFileSync(executable, 'MZ', { mode: 0o644 });

    expect(isValidExecutablePath(executable, { ...llama, platform: 'win32' })).toBe(true);
  });
});
