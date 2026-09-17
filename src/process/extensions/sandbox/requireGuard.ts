/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isPathWithinDirectory } from './pathSafety';

/**
 * Runtime enforcement of manifest-declared permissions for Node.js built-in
 * modules inside the extension sandbox worker.
 *
 * This module holds the *pure* decision logic only. The worker installs it as a
 * `Module.prototype.require` hook (see `sandboxWorker.ts`); everything here is
 * side-effect free and unit testable.
 */

/** Error thrown when sandboxed code touches a capability it did not declare. */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionDenied';
  }
}

/** Subset of the manifest permissions that the require guard reasons about. */
export type RequireGuardPermissions = {
  /** Allows `child_process`. */
  shell?: unknown;
  /** Truthy (boolean `true` or an `{ allowedDomains }` object) allows network modules. */
  network?: unknown;
  /** Filesystem scope. `'none'` denies `fs` entirely. */
  filesystem?: unknown;
};

export type RequireGuardDecision = { allowed: boolean; reason?: string };

/**
 * Built-ins that are never available to extensions: they allow escaping the
 * worker isolation boundary (spawning threads/processes, evaluating code in a
 * fresh realm, attaching a debugger, reading raw heap state, or reaching the
 * raw module loader — `require('module')._load(...)` would otherwise bypass
 * every check below).
 */
const ALWAYS_DENIED_MODULES = new Set(['worker_threads', 'cluster', 'vm', 'inspector', 'v8', 'repl', 'module']);

/** Built-ins that open outbound sockets — gated behind the `network` permission. */
const NETWORK_MODULES = new Set(['net', 'http', 'https', 'http2', 'dns', 'tls', 'dgram']);

/**
 * `fs` exports that take a filesystem path, mapped to the argument indices that
 * must resolve inside the extension directory.
 *
 * Two-path operations (`copyFile`, `cp`, `rename`, `link`, `symlink`) check
 * both ends: copying `/etc/passwd` into the extension directory is as much an
 * escape as writing out of it.
 */
const FS_PATH_ARGUMENT_INDICES: Record<string, readonly number[]> = {
  access: [0],
  accessSync: [0],
  appendFile: [0],
  appendFileSync: [0],
  chmod: [0],
  chmodSync: [0],
  chown: [0],
  chownSync: [0],
  copyFile: [0, 1],
  copyFileSync: [0, 1],
  cp: [0, 1],
  cpSync: [0, 1],
  createReadStream: [0],
  createWriteStream: [0],
  exists: [0],
  existsSync: [0],
  glob: [0],
  globSync: [0],
  lchmod: [0],
  lchmodSync: [0],
  lchown: [0],
  lchownSync: [0],
  link: [0, 1],
  linkSync: [0, 1],
  lstat: [0],
  lstatSync: [0],
  lutimes: [0],
  lutimesSync: [0],
  mkdir: [0],
  mkdirSync: [0],
  mkdtemp: [0],
  mkdtempSync: [0],
  open: [0],
  openSync: [0],
  openAsBlob: [0],
  opendir: [0],
  opendirSync: [0],
  readFile: [0],
  readFileSync: [0],
  readdir: [0],
  readdirSync: [0],
  readlink: [0],
  readlinkSync: [0],
  realpath: [0],
  realpathSync: [0],
  rename: [0, 1],
  renameSync: [0, 1],
  rm: [0],
  rmSync: [0],
  rmdir: [0],
  rmdirSync: [0],
  stat: [0],
  statSync: [0],
  statfs: [0],
  statfsSync: [0],
  symlink: [0, 1],
  symlinkSync: [0, 1],
  truncate: [0],
  truncateSync: [0],
  unlink: [0],
  unlinkSync: [0],
  unwatchFile: [0],
  utimes: [0],
  utimesSync: [0],
  watch: [0],
  watchFile: [0],
  writeFile: [0],
  writeFileSync: [0],
};

/**
 * Every `fs` export whose path arguments are checked when `filesystem` is
 * `'extension-only'`. Exports missing on the current platform (e.g. `lchmod`
 * outside macOS) are simply not present on the wrapper.
 */
export const GUARDED_FS_FUNCTIONS = Object.keys(FS_PATH_ARGUMENT_INDICES) as readonly string[];

/**
 * Function exports that are handed through unwrapped.
 *
 * Descriptor-based APIs take a number, not a path, and a descriptor can only be
 * obtained through the guarded `open`/`openSync`/`opendir`. The remaining names
 * are value types (`Stats`, `Dirent`, the stream classes), not operations.
 *
 * Anything that is a function and appears in neither this list nor
 * {@link FS_PATH_ARGUMENT_INDICES} is denied: a new or platform-specific export
 * must be classified deliberately, never inherited by accident.
 */
export const PASSTHROUGH_FS_FUNCTIONS: ReadonlySet<string> = new Set([
  'close',
  'closeSync',
  'fchmod',
  'fchmodSync',
  'fchown',
  'fchownSync',
  'fdatasync',
  'fdatasyncSync',
  'fstat',
  'fstatSync',
  'fsync',
  'fsyncSync',
  'ftruncate',
  'ftruncateSync',
  'futimes',
  'futimesSync',
  'read',
  'readSync',
  'readv',
  'readvSync',
  'write',
  'writeSync',
  'writev',
  'writevSync',
  'Dir',
  'Dirent',
  'Stats',
  'StatsFs',
  'ReadStream',
  'WriteStream',
  'FileReadStream',
  'FileWriteStream',
]);

/** Strip the `node:` prefix so `node:fs` and `fs` are treated identically. */
function normalizeModuleId(moduleId: string): string {
  return moduleId.startsWith('node:') ? moduleId.slice('node:'.length) : moduleId;
}

/** `fs/promises` → `fs`, `dns/promises` → `dns`. */
function moduleFamily(moduleId: string): string {
  return normalizeModuleId(moduleId).split('/')[0];
}

/** Resolve the effective filesystem scope; the manifest default is `extension-only`. */
export function resolveFilesystemScope(permissions?: RequireGuardPermissions): string {
  const value = permissions?.filesystem;
  return typeof value === 'string' && value.length > 0 ? value : 'extension-only';
}

/** True when the manifest grants any form of network access. */
export function isNetworkPermitted(permissions?: RequireGuardPermissions): boolean {
  const network = permissions?.network;
  if (typeof network === 'object' && network !== null) return true;
  return network === true;
}

/**
 * Decide whether a Node.js built-in module may be loaded with the given
 * declared permissions.
 *
 * Non built-in ids (relative paths, npm packages) are not the concern of this
 * function — callers should only pass built-ins.
 */
export function isBuiltinAllowed(moduleId: string, permissions?: RequireGuardPermissions): RequireGuardDecision {
  const family = moduleFamily(moduleId);

  if (ALWAYS_DENIED_MODULES.has(family)) {
    return {
      allowed: false,
      reason: `Permission denied: require("${moduleId}") is never available to extensions`,
    };
  }

  if (family === 'child_process') {
    if (permissions?.shell === true) return { allowed: true };
    return {
      allowed: false,
      reason: `Permission denied: require("${moduleId}") requires "shell": true in the extension manifest`,
    };
  }

  if (family === 'fs') {
    if (resolveFilesystemScope(permissions) === 'none') {
      return {
        allowed: false,
        reason: `Permission denied: require("${moduleId}") requires a "filesystem" permission other than "none"`,
      };
    }
    return { allowed: true };
  }

  if (NETWORK_MODULES.has(family)) {
    if (isNetworkPermitted(permissions)) return { allowed: true };
    return {
      allowed: false,
      reason: `Permission denied: require("${moduleId}") requires a "network" permission in the extension manifest`,
    };
  }

  return { allowed: true };
}

function toPathString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof URL) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(value)) return value.toString();
  return null;
}

type FsLike = Record<string, unknown>;

/** Marks a wrapper so nesting guards (require + `Module._load`) cannot double-wrap. */
const FS_WRAPPED = Symbol.for('aionui.sandbox.fsWrapped');

/** Every property name reachable on `source`, including inherited ones. */
function reachablePropertyNames(source: object): string[] {
  const names = new Set<string>();
  let current: object | null = source;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) names.add(name);
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names];
}

function readProperty(source: FsLike, name: string): unknown {
  try {
    return source[name];
  } catch {
    return undefined;
  }
}

/**
 * Return a view of an `fs`-like module whose path-taking entry points reject
 * paths outside `extensionDir`.
 *
 * The original module is never mutated: the wrapper is a new object whose
 * prototype is the real module, so non-function exports (`constants`, …) still
 * resolve. Function exports are deny-by-default — a path-taking export is
 * guarded, an explicitly listed descriptor-based/value export is passed
 * through, and anything else throws {@link PermissionDeniedError}.
 *
 * Denials always throw synchronously, including for the promise-based API — a
 * permission violation is a programming error in the extension, not a runtime
 * condition it should catch as a rejection.
 */
export function wrapFsModule<T>(
  fsModule: T,
  extensionDir: string,
  onDenied: (moduleId: string, reason: string) => void,
  moduleId = 'fs'
): T {
  const source = fsModule as unknown as FsLike;
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return fsModule;
  if (source[FS_WRAPPED as unknown as string]) return fsModule;

  const wrapped = Object.create(source as object) as FsLike;

  const define = (name: string | symbol, value: unknown): void => {
    // defineProperty, not assignment: the source may expose read-only accessors
    // (e.g. an ES module namespace), which would make a plain assignment throw.
    Object.defineProperty(wrapped, name, {
      value,
      writable: true,
      enumerable: typeof name === 'string',
      configurable: true,
    });
  };

  const deny = (reason: string): never => {
    onDenied(moduleId, reason);
    throw new PermissionDeniedError(reason);
  };

  const guardPaths = (name: string, indices: readonly number[], original: (...args: unknown[]) => unknown) => {
    return function guardedFsFunction(this: unknown, ...args: unknown[]): unknown {
      for (const index of indices) {
        const targetPath = toPathString(args[index]);
        if (targetPath !== null && !isPathWithinDirectory(targetPath, extensionDir)) {
          deny(
            `Permission denied: ${moduleId}.${name}("${targetPath}") is outside the extension directory ` +
              `(filesystem permission is "extension-only")`
          );
        }
      }
      return original.apply(source, args);
    };
  };

  for (const name of reachablePropertyNames(source)) {
    if (name === 'promises' || name === 'constructor') continue;

    const original = readProperty(source, name);
    if (typeof original !== 'function') continue;

    const indices = FS_PATH_ARGUMENT_INDICES[name];
    if (indices) {
      const guarded = guardPaths(name, indices, original as (...args: unknown[]) => unknown);
      // `realpath.native` / `realpathSync.native` are separate implementations
      // hanging off the function object; guard them too instead of dropping them.
      const nativeVariant = (original as unknown as FsLike).native;
      if (typeof nativeVariant === 'function') {
        Object.defineProperty(guarded, 'native', {
          value: guardPaths(`${name}.native`, indices, nativeVariant as (...args: unknown[]) => unknown),
          writable: true,
          enumerable: false,
          configurable: true,
        });
      }
      define(name, guarded);
      continue;
    }

    if (PASSTHROUGH_FS_FUNCTIONS.has(name)) continue;

    define(name, function deniedFsFunction(): never {
      return deny(
        `Permission denied: ${moduleId}.${name}() is not available to extensions ` +
          `(filesystem permission is "extension-only")`
      );
    });
  }

  const promises = readProperty(source, 'promises');
  if (promises && typeof promises === 'object') {
    define('promises', wrapFsModule(promises, extensionDir, onDenied, `${moduleId}/promises`));
  }

  define(FS_WRAPPED, true);

  return wrapped as unknown as T;
}

export type GuardedRequireOptions = {
  /** Permissions declared in the extension manifest. */
  permissions?: RequireGuardPermissions;
  /** Absolute path of the extension directory, used for `extension-only` filesystem scoping. */
  extensionDir: string;
  /** Invoked before a denial is thrown, so the host can surface it. */
  onDenied: (moduleId: string, reason: string) => void;
  /** Overridable for tests; defaults to Node's `module.isBuiltin`. */
  isBuiltinModule?: (moduleId: string) => boolean;
};

/**
 * A guarded `require`: it receives the requested id plus the real loader and
 * either delegates, wraps the result, or throws {@link PermissionDeniedError}.
 */
export type GuardedRequire = (moduleId: string, load: (moduleId: string) => unknown) => unknown;

/**
 * Build the `require` interceptor installed by the sandbox worker.
 *
 * Only Node.js built-ins are inspected — relative requires and npm
 * dependencies bundled with the extension are loaded unchanged.
 */
export function createGuardedRequire(options: GuardedRequireOptions): GuardedRequire {
  const { permissions, extensionDir, onDenied, isBuiltinModule = isBuiltin } = options;

  return (moduleId, load) => {
    if (typeof moduleId !== 'string' || !isBuiltinModule(moduleId)) {
      return load(moduleId);
    }

    const decision = isBuiltinAllowed(moduleId, permissions);
    if (!decision.allowed) {
      const reason = decision.reason ?? `Permission denied: require("${moduleId}")`;
      onDenied(moduleId, reason);
      throw new PermissionDeniedError(reason);
    }

    const loaded = load(moduleId);

    if (moduleFamily(moduleId) === 'fs' && resolveFilesystemScope(permissions) === 'extension-only') {
      return wrapFsModule(loaded, extensionDir, onDenied, normalizeModuleId(moduleId));
    }

    return loaded;
  };
}
