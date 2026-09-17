/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extension Worker Script — runs inside a Worker Thread.
 *
 * This script:
 * 1. Receives extension config via workerData
 * 2. Exposes a restricted `aion` API proxy to the extension
 * 3. Loads and executes the extension entry point via native require
 * 4. Proxies communication via structured messages
 *
 * Current isolation model:
 * - Electron main-process APIs are not directly accessible (different process/thread)
 * - The `aion` proxy provides a structured communication channel to the main thread
 * - Declared permissions in the manifest are enforced at runtime inside this thread:
 *   - storage access is gated by the storage permission flag on both the worker
 *     and host sides
 *   - `Module.prototype.require` *and* `Module._load` hooks (see
 *     `requireGuard.ts`) gate Node.js built-ins: `child_process` needs `shell`,
 *     `fs` needs a `filesystem` scope (and is path-restricted when the scope is
 *     `extension-only`), socket modules need `network`, and
 *     thread/VM/debugger/`module` are always denied
 *   - `process.binding`, `process._linkedBinding` and `process.dlopen` are
 *     replaced with throwing stubs, so internal bindings and native addons
 *     cannot be reached around the module hooks
 *   - `fetch` / `WebSocket` are replaced with throwing stubs without `network`
 * - KNOWN GAP — dynamic `import()`: ESM specifiers are resolved by the V8/Node
 *   ESM loader, not by CJS `Module._load`, so `await import('child_process')`
 *   inside extension code is NOT intercepted by these hooks. Do not assume the
 *   guards close it.
 * - Enforcement is best-effort in-thread hardening, not a security boundary:
 *   extension code still runs with Worker Thread privileges and can reach
 *   capabilities obtained before the hook is installed.
 */

import { parentPort, workerData } from 'worker_threads';
import Module from 'node:module';
import * as path from 'path';
import type { SandboxMessage } from './sandbox';
import { hasSandboxStoragePermission } from './permissions';
import { createGuardedRequire, isNetworkPermitted, PermissionDeniedError } from './requireGuard';
import type { RequireGuardPermissions } from './requireGuard';

if (!parentPort) {
  throw new Error('This script must be run as a Worker Thread');
}

const port = parentPort;
const config = workerData as {
  extensionName: string;
  extensionDir: string;
  entryPoint: string;
  permissions: Record<string, unknown>;
};

// ============ Restricted Console ============

const sandboxConsole = {
  log: (...args: unknown[]) => {
    port.postMessage({ type: 'log', level: 'log', args: args.map(String) } satisfies SandboxMessage);
  },
  warn: (...args: unknown[]) => {
    port.postMessage({ type: 'log', level: 'warn', args: args.map(String) } satisfies SandboxMessage);
  },
  error: (...args: unknown[]) => {
    port.postMessage({ type: 'log', level: 'error', args: args.map(String) } satisfies SandboxMessage);
  },
  info: (...args: unknown[]) => {
    port.postMessage({ type: 'log', level: 'log', args: args.map(String) } satisfies SandboxMessage);
  },
};

// ============ Extension API Proxy ============

/**
 * The `aion` object available to sandboxed extensions.
 * All method calls are proxied to the main thread.
 */
const aionProxy = {
  extensionName: config.extensionName,
  extensionDir: config.extensionDir,

  /** Send a message to the main thread (UI layer) */
  postToUI: (message: unknown) => {
    port.postMessage({ type: 'event', name: 'ui-message', payload: message } satisfies SandboxMessage);
  },

  /** Emit an event on the extension event bus */
  emitEvent: (eventName: string, payload?: unknown) => {
    port.postMessage({ type: 'event', name: `ext:${eventName}`, payload } satisfies SandboxMessage);
  },

  ...(hasSandboxStoragePermission(config.permissions)
    ? {
        storage: {
          get: async (key: string): Promise<unknown> => callMainThread('storage.get', [key]),
          set: async (key: string, value: unknown): Promise<void> => {
            await callMainThread('storage.set', [key, value]);
          },
          delete: async (key: string): Promise<void> => {
            await callMainThread('storage.delete', [key]);
          },
        },
      }
    : {}),
};

let callIdCounter = 0;
const pendingMainCalls = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

/** Timeout for Worker → Host API calls (ms). Matches Host's default callTimeout. */
const CALL_MAIN_TIMEOUT = 30_000;

function callMainThread(method: string, args: unknown[]): Promise<unknown> {
  const id = `w-${++callIdCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMainCalls.delete(id);
      reject(new Error(`[Sandbox Worker] Call "${method}" timed out after ${CALL_MAIN_TIMEOUT}ms`));
    }, CALL_MAIN_TIMEOUT);

    pendingMainCalls.set(id, { resolve, reject, timer });
    port.postMessage({ type: 'api-call', id, method, args } satisfies SandboxMessage);
  });
}

// ============ Message Handler ============

const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

port.on('message', (msg: SandboxMessage) => {
  switch (msg.type) {
    case 'api-call': {
      // Main thread calling a method on the extension
      handleApiCall(msg.id, msg.method, msg.args);
      break;
    }
    case 'api-response': {
      // Response to our call to main thread
      const pending = pendingMainCalls.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingMainCalls.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
      break;
    }
    case 'event': {
      // Event from main thread
      const handlers = eventHandlers.get(msg.name);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.payload);
          } catch (error) {
            sandboxConsole.error(`Event handler error for "${msg.name}":`, error);
          }
        }
      }
      break;
    }
    case 'shutdown': {
      cleanup();
      process.exit(0);
      break;
    }
  }
});

// ============ Extension Method Registry ============

const extensionMethods = new Map<string, (...args: unknown[]) => unknown>();

function handleApiCall(id: string, method: string, args: unknown[]): void {
  const fn = extensionMethods.get(method);
  if (!fn) {
    port.postMessage({
      type: 'api-response',
      id,
      error: `Method "${method}" not found in extension`,
    } satisfies SandboxMessage);
    return;
  }

  try {
    const result = fn(...args);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>)
        .then((r) => {
          port.postMessage({ type: 'api-response', id, result: r } satisfies SandboxMessage);
        })
        .catch((e) => {
          port.postMessage({ type: 'api-response', id, error: String(e) } satisfies SandboxMessage);
        });
    } else {
      port.postMessage({ type: 'api-response', id, result } satisfies SandboxMessage);
    }
  } catch (error) {
    port.postMessage({ type: 'api-response', id, error: String(error) } satisfies SandboxMessage);
  }
}

// ============ Permission Enforcement ============

/** Surface a denial to the host so it is visible in the main-process log. */
function reportDenial(reason: string): void {
  port.postMessage({
    type: 'log',
    level: 'error',
    args: [`[${config.extensionName}] ${reason}`],
  } satisfies SandboxMessage);
}

/**
 * Install the permission enforcement layer.
 *
 * Must run before the extension entry point is loaded, otherwise the entry's
 * own top-level requires bypass the hook.
 */
function installPermissionGuards(permissions: RequireGuardPermissions): void {
  const guardedRequire = createGuardedRequire({
    permissions,
    extensionDir: config.extensionDir,
    onDenied: (_moduleId, reason) => reportDenial(reason),
  });

  const originalRequire = Module.prototype.require;
  Module.prototype.require = function patchedRequire(this: unknown, id: string): unknown {
    return guardedRequire(id, (resolvedId) => originalRequire.call(this as Module, resolvedId));
  } as typeof Module.prototype.require;

  // `Module.prototype.require` is only the front door. `require('module')` is
  // denied outright, but `module.constructor._load` reaches the same loader
  // from any module object the extension already holds, so patch it too.
  type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
  const moduleInternals = Module as unknown as { _load: ModuleLoader };
  const originalLoad = moduleInternals._load;
  if (typeof originalLoad === 'function') {
    moduleInternals._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
      return guardedRequire(request, (resolvedId) => originalLoad.call(Module, resolvedId, parent, isMain));
    };
  }

  // Internal bindings and native addons bypass the module system entirely.
  const processInternals = process as unknown as Record<string, unknown>;
  for (const api of ['binding', '_linkedBinding', 'dlopen'] as const) {
    processInternals[api] = (): never => {
      const reason = `Permission denied: process.${api}() is not available to extensions`;
      reportDenial(reason);
      throw new PermissionDeniedError(reason);
    };
  }

  if (!isNetworkPermitted(permissions)) {
    const denyGlobal = (api: string) => {
      return (): never => {
        const reason = `Permission denied: ${api} requires a "network" permission in the extension manifest`;
        reportDenial(reason);
        throw new PermissionDeniedError(reason);
      };
    };

    (globalThis as Record<string, unknown>).fetch = denyGlobal('fetch()');
    if ('WebSocket' in globalThis) {
      (globalThis as Record<string, unknown>).WebSocket = denyGlobal('WebSocket');
    }
  }
}

// ============ Load Extension ============

let extensionModule: unknown = null;
let cleanupFn: (() => void) | null = null;

function cleanup(): void {
  if (cleanupFn) {
    try {
      cleanupFn();
    } catch (error) {
      sandboxConsole.error('Cleanup error:', error);
    }
  }
}

try {
  const entryPath = path.resolve(config.extensionDir, config.entryPoint);

  // Override console in the worker
  (globalThis as any).console = sandboxConsole;
  // Expose aion proxy
  (globalThis as any).aion = aionProxy;

  // Enforce declared permissions before any extension code runs
  installPermissionGuards((config.permissions ?? {}) as RequireGuardPermissions);

  // eslint-disable-next-line no-eval
  const nativeRequire = eval('require');
  extensionModule = nativeRequire(entryPath);

  const mod = extensionModule as Record<string, unknown>;

  // Register exported functions as callable methods
  if (mod && typeof mod === 'object') {
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === 'function') {
        extensionMethods.set(key, value as (...args: unknown[]) => unknown);
      }
    }
  }

  // Check for cleanup/dispose function
  if (typeof mod?.cleanup === 'function') {
    cleanupFn = mod.cleanup as () => void;
  } else if (typeof mod?.dispose === 'function') {
    cleanupFn = mod.dispose as () => void;
  }

  // Signal ready
  port.postMessage({ type: 'ready' } satisfies SandboxMessage);
} catch (error) {
  sandboxConsole.error('Failed to load extension:', error);
  port.postMessage({ type: 'log', level: 'error', args: [`Failed to load: ${error}`] } satisfies SandboxMessage);
  process.exit(1);
}
