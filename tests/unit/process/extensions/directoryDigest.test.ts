/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeDirectoryDigest,
  tryComputeDirectoryDigest,
} from '../../../../src/process/extensions/hub/directoryDigest';

let root: string;

function makeDir(name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-dir-digest-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('extensions/hub computeDirectoryDigest', () => {
  it('returns a sha256-prefixed hex digest', () => {
    const dir = makeDir('a', { 'index.js': 'x' });
    expect(computeDirectoryDigest(dir)).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('is identical for two directories with the same contents', () => {
    const a = makeDir('a', { 'index.js': 'body', 'nested/deep.txt': 'deep' });
    const b = makeDir('b', { 'nested/deep.txt': 'deep', 'index.js': 'body' });

    expect(computeDirectoryDigest(a)).toBe(computeDirectoryDigest(b));
  });

  it('is stable across repeated calls', () => {
    const dir = makeDir('a', { 'index.js': 'body' });
    expect(computeDirectoryDigest(dir)).toBe(computeDirectoryDigest(dir));
  });

  it('does not depend on the directory path itself', () => {
    const a = makeDir('one', { 'index.js': 'body' });
    const b = makeDir('two', { 'index.js': 'body' });
    expect(computeDirectoryDigest(a)).toBe(computeDirectoryDigest(b));
  });

  it('changes when a file’s content changes', () => {
    const dir = makeDir('a', { 'index.js': 'body' });
    const before = computeDirectoryDigest(dir);

    fs.writeFileSync(path.join(dir, 'index.js'), 'body-modified', 'utf-8');

    expect(computeDirectoryDigest(dir)).not.toBe(before);
  });

  it('changes when a file is added', () => {
    const dir = makeDir('a', { 'index.js': 'body' });
    const before = computeDirectoryDigest(dir);

    fs.writeFileSync(path.join(dir, 'extra.js'), 'body', 'utf-8');

    expect(computeDirectoryDigest(dir)).not.toBe(before);
  });

  it('changes when a file is removed', () => {
    const dir = makeDir('a', { 'index.js': 'body', 'extra.js': 'body' });
    const before = computeDirectoryDigest(dir);

    fs.rmSync(path.join(dir, 'extra.js'));

    expect(computeDirectoryDigest(dir)).not.toBe(before);
  });

  it('changes when a file is renamed but its bytes are kept', () => {
    const dir = makeDir('a', { 'index.js': 'body' });
    const before = computeDirectoryDigest(dir);

    fs.renameSync(path.join(dir, 'index.js'), path.join(dir, 'renamed.js'));

    expect(computeDirectoryDigest(dir)).not.toBe(before);
  });

  it('records a symlink by its target instead of following it', () => {
    const dir = makeDir('a', { 'index.js': 'body' });
    const outside = makeDir('outside', { 'secret.txt': 'body' });

    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
    const withLink = computeDirectoryDigest(dir);

    fs.rmSync(path.join(dir, 'link.txt'));
    fs.writeFileSync(path.join(dir, 'link.txt'), 'body', 'utf-8');

    expect(computeDirectoryDigest(dir)).not.toBe(withLink);
  });

  it('throws for a directory that does not exist', () => {
    expect(() => computeDirectoryDigest(path.join(root, 'missing'))).toThrow();
  });
});

describe('extensions/hub tryComputeDirectoryDigest', () => {
  it('returns the digest for a readable directory', () => {
    const dir = makeDir('a', { 'index.js': 'body' });
    expect(tryComputeDirectoryDigest(dir)).toBe(computeDirectoryDigest(dir));
  });

  it('returns null instead of throwing for an unreadable directory', () => {
    expect(tryComputeDirectoryDigest(path.join(root, 'missing'))).toBeNull();
  });
});
