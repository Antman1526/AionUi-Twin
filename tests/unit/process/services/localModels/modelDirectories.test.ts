import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeModelDirectories,
  resolveModelDirectories,
} from '../../../../../src/common/utils/localModelProviders';
import {
  getDefaultLocalModelDirectories,
  MODEL_DIRS_ENV,
} from '../../../../../src/process/services/localModels/defaultModelDirectories';

describe('normalizeModelDirectories', () => {
  it('trims, drops empty entries, and de-duplicates while preserving order', () => {
    expect(normalizeModelDirectories(['  /a  ', '/b', '/a', '', '   ', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
  });

  it('returns an empty array for non-array / undefined input', () => {
    expect(normalizeModelDirectories(undefined)).toEqual([]);
    // @ts-expect-error testing invalid runtime input
    expect(normalizeModelDirectories('nope')).toEqual([]);
  });
});

describe('resolveModelDirectories', () => {
  it('falls back to the provided defaults when no valid directories are configured', () => {
    expect(resolveModelDirectories(undefined, ['/a', '/b'])).toEqual(['/a', '/b']);
    expect(resolveModelDirectories(['', '   '], ['/a'])).toEqual(['/a']);
    expect(resolveModelDirectories(undefined, undefined)).toEqual([]);
  });

  it('uses the configured directories when at least one is valid', () => {
    expect(resolveModelDirectories(['/custom/models', ' /custom/models '], ['/default'])).toEqual(['/custom/models']);
  });
});

describe('getDefaultLocalModelDirectories', () => {
  const previousEnv = process.env[MODEL_DIRS_ENV];
  const tempDirs: string[] = [];

  afterEach(() => {
    if (previousEnv === undefined) delete process.env[MODEL_DIRS_ENV];
    else process.env[MODEL_DIRS_ENV] = previousEnv;
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it('includes directories from the AIONUI_MODEL_DIRS environment variable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-env-models-'));
    tempDirs.push(dir);
    process.env[MODEL_DIRS_ENV] = dir;
    expect(getDefaultLocalModelDirectories()).toContain(dir);
  });

  it('never contains hardcoded personal machine paths and returns a normalized array', () => {
    delete process.env[MODEL_DIRS_ENV];
    const result = getDefaultLocalModelDirectories();
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toContain('/Volumes/MainStore/Development/AI_Models');
    expect(result.every((dir) => dir.trim() === dir && dir.length > 0)).toBe(true);
    // No duplicates.
    expect(new Set(result).size).toBe(result.length);
  });
});
