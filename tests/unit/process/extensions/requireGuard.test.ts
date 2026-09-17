/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createGuardedRequire,
  GUARDED_FS_FUNCTIONS,
  isBuiltinAllowed,
  isNetworkPermitted,
  PermissionDeniedError,
  resolveFilesystemScope,
  wrapFsModule,
} from '../../../../src/process/extensions/sandbox/requireGuard';

const NO_PERMISSIONS = undefined;

describe('extensions/sandbox requireGuard — isBuiltinAllowed', () => {
  describe('always-denied modules', () => {
    for (const id of ['worker_threads', 'cluster', 'vm', 'inspector', 'v8', 'repl', 'module']) {
      it(`denies "${id}" even with every permission granted`, () => {
        const decision = isBuiltinAllowed(id, { shell: true, network: true, filesystem: 'full' });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('never available');
      });

      it(`denies "node:${id}" (prefixed form)`, () => {
        expect(isBuiltinAllowed(`node:${id}`, { shell: true, network: true, filesystem: 'full' }).allowed).toBe(false);
      });
    }

    it('denies submodules of a denied family (node:inspector/promises)', () => {
      expect(isBuiltinAllowed('node:inspector/promises', { shell: true }).allowed).toBe(false);
    });
  });

  describe('child_process', () => {
    it('denies child_process without the shell permission', () => {
      const decision = isBuiltinAllowed('child_process', NO_PERMISSIONS);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('"shell": true');
    });

    it('denies child_process when shell is false', () => {
      expect(isBuiltinAllowed('child_process', { shell: false }).allowed).toBe(false);
    });

    it('denies child_process when shell is a truthy non-boolean', () => {
      expect(isBuiltinAllowed('child_process', { shell: 'yes' }).allowed).toBe(false);
    });

    it('allows child_process when shell is true', () => {
      expect(isBuiltinAllowed('child_process', { shell: true }).allowed).toBe(true);
    });

    it('allows node:child_process when shell is true', () => {
      expect(isBuiltinAllowed('node:child_process', { shell: true }).allowed).toBe(true);
    });
  });

  describe('filesystem', () => {
    it('allows fs with the default (extension-only) scope', () => {
      expect(isBuiltinAllowed('fs', NO_PERMISSIONS).allowed).toBe(true);
    });

    it('allows fs/promises with the workspace scope', () => {
      expect(isBuiltinAllowed('fs/promises', { filesystem: 'workspace' }).allowed).toBe(true);
    });

    it('denies fs when the scope is none', () => {
      const decision = isBuiltinAllowed('fs', { filesystem: 'none' });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('"filesystem"');
    });

    it('denies node:fs/promises when the scope is none', () => {
      expect(isBuiltinAllowed('node:fs/promises', { filesystem: 'none' }).allowed).toBe(false);
    });
  });

  describe('network modules', () => {
    const networkModules = ['net', 'http', 'https', 'http2', 'dns', 'tls', 'dgram'];

    for (const id of networkModules) {
      it(`denies "${id}" without a network permission`, () => {
        const decision = isBuiltinAllowed(id, NO_PERMISSIONS);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('"network"');
      });

      it(`allows "${id}" when network is true`, () => {
        expect(isBuiltinAllowed(id, { network: true }).allowed).toBe(true);
      });

      it(`allows "${id}" when network declares allowedDomains`, () => {
        expect(isBuiltinAllowed(id, { network: { allowedDomains: ['example.com'] } }).allowed).toBe(true);
      });
    }

    it('denies network modules when network is false', () => {
      expect(isBuiltinAllowed('https', { network: false }).allowed).toBe(false);
    });

    it('denies dns/promises without a network permission', () => {
      expect(isBuiltinAllowed('dns/promises', NO_PERMISSIONS).allowed).toBe(false);
    });
  });

  describe('unrestricted modules', () => {
    for (const id of ['path', 'node:path', 'util', 'os', 'crypto', 'events', 'url', 'zlib']) {
      it(`allows "${id}" with no permissions declared`, () => {
        expect(isBuiltinAllowed(id, NO_PERMISSIONS)).toEqual({ allowed: true });
      });
    }
  });
});

describe('extensions/sandbox requireGuard — permission helpers', () => {
  it('defaults the filesystem scope to extension-only', () => {
    expect(resolveFilesystemScope(undefined)).toBe('extension-only');
    expect(resolveFilesystemScope({})).toBe('extension-only');
    expect(resolveFilesystemScope({ filesystem: 'full' })).toBe('full');
  });

  it('treats only true or an object as network permission', () => {
    expect(isNetworkPermitted(undefined)).toBe(false);
    expect(isNetworkPermitted({ network: false })).toBe(false);
    expect(isNetworkPermitted({ network: 'true' })).toBe(false);
    expect(isNetworkPermitted({ network: true })).toBe(true);
    expect(isNetworkPermitted({ network: { allowedDomains: ['a.com'] } })).toBe(true);
  });
});

describe('extensions/sandbox requireGuard — createGuardedRequire', () => {
  const extensionDir = '/tmp/aionui-guard-ext';

  function makeGuard(permissions?: Record<string, unknown>) {
    const onDenied = vi.fn();
    const guard = createGuardedRequire({
      permissions,
      extensionDir,
      onDenied,
      isBuiltinModule: (id) => !id.startsWith('.') && !id.startsWith('/'),
    });
    return { guard, onDenied };
  }

  it('passes non-builtin ids straight through to the loader', () => {
    const { guard, onDenied } = makeGuard();
    const load = vi.fn().mockReturnValue({ hello: 'world' });

    expect(guard('./entry.js', load)).toEqual({ hello: 'world' });
    expect(load).toHaveBeenCalledWith('./entry.js');
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('throws PermissionDeniedError and reports the denial for a blocked builtin', () => {
    const { guard, onDenied } = makeGuard();
    const load = vi.fn();

    expect(() => guard('child_process', load)).toThrow(PermissionDeniedError);
    expect(load).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(onDenied.mock.calls[0][0]).toBe('child_process');
    expect(onDenied.mock.calls[0][1]).toContain('"shell": true');
  });

  it('loads an allowed builtin unchanged', () => {
    const { guard, onDenied } = makeGuard({ shell: true });
    const childProcess = { execSync: () => 'ok' };
    const load = vi.fn().mockReturnValue(childProcess);

    expect(guard('child_process', load)).toBe(childProcess);
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('returns the real fs module untouched when the scope is not extension-only', () => {
    const { guard } = makeGuard({ filesystem: 'full' });
    const fsModule = { readFileSync: () => 'data' };
    const load = vi.fn().mockReturnValue(fsModule);

    expect(guard('fs', load)).toBe(fsModule);
  });

  it('wraps fs when the scope is extension-only', () => {
    const { guard } = makeGuard({ filesystem: 'extension-only' });
    const readFileSync = vi.fn().mockReturnValue('data');
    const load = vi.fn().mockReturnValue({ readFileSync });

    const wrapped = guard('fs', load) as { readFileSync: (p: string) => string };
    expect(wrapped.readFileSync).not.toBe(readFileSync);
  });
});

describe('extensions/sandbox requireGuard — wrapFsModule', () => {
  let extensionDir: string;
  let outsideDir: string;

  beforeAll(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-fsguard-'));
    extensionDir = path.join(root, 'ext');
    outsideDir = path.join(root, 'outside');
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(extensionDir, 'inside.txt'), 'inside');
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(extensionDir), { recursive: true, force: true });
  });

  function wrap() {
    const onDenied = vi.fn();
    const wrapped = wrapFsModule(fs, extensionDir, onDenied);
    return { wrapped, onDenied };
  }

  it('allows reads inside the extension directory', () => {
    const { wrapped, onDenied } = wrap();
    expect(wrapped.readFileSync(path.join(extensionDir, 'inside.txt'), 'utf-8')).toBe('inside');
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('rejects reads outside the extension directory', () => {
    const { wrapped, onDenied } = wrap();
    expect(() => wrapped.readFileSync(path.join(outsideDir, 'secret.txt'), 'utf-8')).toThrow(PermissionDeniedError);
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it('rejects path traversal escaping the extension directory', () => {
    const { wrapped } = wrap();
    expect(() => wrapped.readFileSync(path.join(extensionDir, '..', 'outside', 'secret.txt'), 'utf-8')).toThrow(
      PermissionDeniedError
    );
  });

  it('rejects writes outside the extension directory', () => {
    const { wrapped } = wrap();
    expect(() => wrapped.writeFileSync(path.join(outsideDir, 'pwned.txt'), 'x')).toThrow(PermissionDeniedError);
    expect(fs.existsSync(path.join(outsideDir, 'pwned.txt'))).toBe(false);
  });

  it('rejects a file:// URL pointing outside the extension directory', () => {
    const { wrapped } = wrap();
    const url = new URL(`file://${path.join(outsideDir, 'secret.txt')}`);
    expect(() => wrapped.readFileSync(url, 'utf-8')).toThrow(PermissionDeniedError);
  });

  it('rejects a Buffer path pointing outside the extension directory', () => {
    const { wrapped } = wrap();
    expect(() => wrapped.readFileSync(Buffer.from(path.join(outsideDir, 'secret.txt')))).toThrow(PermissionDeniedError);
  });

  it('wraps every documented fs entry point', () => {
    const { wrapped } = wrap();
    for (const name of GUARDED_FS_FUNCTIONS) {
      // Some exports only exist on some platforms (e.g. `lchmod` on macOS).
      if (typeof (fs as unknown as Record<string, unknown>)[name] !== 'function') continue;
      expect(Object.prototype.hasOwnProperty.call(wrapped, name), `${name} should be wrapped`).toBe(true);
    }
  });

  it('rejects the second path of two-path operations', () => {
    const { wrapped, onDenied } = wrap();
    expect(() =>
      wrapped.copyFileSync(path.join(extensionDir, 'inside.txt'), path.join(outsideDir, 'stolen.txt'))
    ).toThrow(PermissionDeniedError);
    expect(fs.existsSync(path.join(outsideDir, 'stolen.txt'))).toBe(false);
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it('rejects copyFileSync reading a file outside the extension directory', () => {
    const { wrapped } = wrap();
    expect(() => wrapped.copyFileSync(path.join(outsideDir, 'secret.txt'), path.join(extensionDir, 'x.txt'))).toThrow(
      PermissionDeniedError
    );
    expect(fs.existsSync(path.join(extensionDir, 'x.txt'))).toBe(false);
  });

  it('rejects appendFileSync, renameSync and symlinkSync outside the extension directory', () => {
    const { wrapped } = wrap();
    expect(() => wrapped.appendFileSync(path.join(outsideDir, 'secret.txt'), 'x')).toThrow(PermissionDeniedError);
    expect(() => wrapped.renameSync(path.join(extensionDir, 'inside.txt'), path.join(outsideDir, 'moved.txt'))).toThrow(
      PermissionDeniedError
    );
    expect(() => wrapped.symlinkSync(path.join(outsideDir, 'secret.txt'), path.join(outsideDir, 'link.txt'))).toThrow(
      PermissionDeniedError
    );
    expect(fs.readFileSync(path.join(outsideDir, 'secret.txt'), 'utf-8')).toBe('secret');
  });

  it('allows the same operations inside the extension directory', () => {
    const { wrapped, onDenied } = wrap();
    const copied = path.join(extensionDir, 'copy.txt');
    const renamed = path.join(extensionDir, 'renamed.txt');

    wrapped.copyFileSync(path.join(extensionDir, 'inside.txt'), copied);
    wrapped.appendFileSync(copied, '-more');
    wrapped.renameSync(copied, renamed);

    expect(fs.readFileSync(renamed, 'utf-8')).toBe('inside-more');
    expect(onDenied).not.toHaveBeenCalled();
    fs.rmSync(renamed, { force: true });
  });

  it('denies a function export that is neither path-guarded nor explicitly passed through', () => {
    const onDenied = vi.fn();
    const wrapped = wrapFsModule(
      { readFileSync: fs.readFileSync, mysteryEscapeHatch: () => 'pwned' } as unknown as Record<string, unknown>,
      extensionDir,
      onDenied
    ) as { mysteryEscapeHatch: () => string };

    expect(() => wrapped.mysteryEscapeHatch()).toThrow(PermissionDeniedError);
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it('still passes descriptor-based APIs through', () => {
    const { wrapped } = wrap();
    const fd = wrapped.openSync(path.join(extensionDir, 'inside.txt'), 'r');
    try {
      expect(wrapped.fstatSync(fd).isFile()).toBe(true);
    } finally {
      wrapped.closeSync(fd);
    }
  });

  it('does not wrap an already wrapped module twice', () => {
    const { wrapped, onDenied } = wrap();
    const again = wrapFsModule(wrapped, extensionDir, onDenied);
    expect(again).toBe(wrapped);
  });

  it('guards realpathSync.native as well', () => {
    const { wrapped } = wrap();
    expect(() => wrapped.realpathSync.native(path.join(outsideDir, 'secret.txt'))).toThrow(PermissionDeniedError);
  });

  it('wraps the promises sub-module too (denials throw synchronously)', async () => {
    const { wrapped } = wrap();
    expect(() => wrapped.promises.readFile(path.join(outsideDir, 'secret.txt'), 'utf-8')).toThrow(
      PermissionDeniedError
    );
    await expect(wrapped.promises.readFile(path.join(extensionDir, 'inside.txt'), 'utf-8')).resolves.toBe('inside');
  });

  it('does not mutate the real fs module', () => {
    const originalReadFileSync = fs.readFileSync;
    wrap();
    expect(fs.readFileSync).toBe(originalReadFileSync);
    expect(fs.readFileSync(path.join(outsideDir, 'secret.txt'), 'utf-8')).toBe('secret');
  });

  it('exposes un-wrapped exports through the prototype chain', () => {
    const { wrapped } = wrap();
    expect(wrapped.constants.F_OK).toBe(fs.constants.F_OK);
    expect(typeof wrapped.existsSync).toBe('function');
  });
});
