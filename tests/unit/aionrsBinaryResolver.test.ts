/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAionrsBinary } from '../../src/process/agent/aionrs/binaryResolver';

const binaryName = process.platform === 'win32' ? 'aionrs.exe' : 'aionrs';
const runtimeKey = `${process.platform}-${process.arch}`;
const originalResourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

describe('resolveAionrsBinary', () => {
  let tempRoot: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalResourcesDescriptor) {
      Object.defineProperty(process, 'resourcesPath', originalResourcesDescriptor);
    } else {
      delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('resolves the development bundled binary from the repo resources directory', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'aionrs-binary-resolver-'));
    const binaryPath = join(tempRoot, 'resources', 'bundled-aionrs', runtimeKey, binaryName);
    mkdirSync(join(tempRoot, 'resources', 'bundled-aionrs', runtimeKey), { recursive: true });
    writeFileSync(binaryPath, '');
    chmodSync(binaryPath, 0o755);

    Object.defineProperty(process, 'resourcesPath', {
      value: join(tempRoot, 'missing-packaged-resources'),
      configurable: true,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);

    expect(resolveAionrsBinary()).toBe(binaryPath);
  });
});
