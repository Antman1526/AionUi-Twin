/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import type { LocalModelRuntime } from './LocalModelDiscoveryService';

/**
 * Provider object for a managed local runtime. Carries `useModel` in addition to
 * the persisted `IProvider` fields so the UI can pre-select the single model.
 */
export type LocalRuntimeProvider = IProvider & { useModel: string };

/** Id prefix for the single auto-managed local provider entry. */
export const MANAGED_LOCAL_PROVIDER_PREFIX = 'local-llama-cpp-';

/**
 * Return a new provider list with the managed local provider replaced by `next`
 * (or removed when `next` is null). Only entries whose id starts with
 * {@link MANAGED_LOCAL_PROVIDER_PREFIX} are touched — user-defined providers are
 * preserved untouched, so registration is idempotent and non-destructive.
 */
export function replaceManagedProvider(list: IProvider[], next: IProvider | null): IProvider[] {
  const withoutManaged = list.filter((provider) => !provider.id?.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX));
  return next ? [...withoutManaged, next] : withoutManaged;
}

/**
 * Build a no-key, enabled provider pointing at a local OpenAI-compatible runtime.
 * The provider id is prefixed by the runtime slug so the managed entry can be
 * found and updated idempotently without clobbering user-defined providers.
 */
export function createLocalProviderFromRuntime({
  runtime,
  name,
  baseUrl,
  models,
}: {
  runtime: LocalModelRuntime;
  name: string;
  baseUrl: string;
  models: string[];
}): LocalRuntimeProvider {
  const runtimeSlug = runtime.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    id: `local-${runtimeSlug}-${uuid()}`,
    name: `Local ${name}`,
    platform: 'custom',
    baseUrl,
    apiKey: '',
    model: models,
    useModel: models[0] ?? '',
    enabled: true,
  };
}

/**
 * Resolved handle to a running managed llama-server.
 */
export type ManagedServerHandle = {
  port: number;
  baseUrl: string;
  pid: number;
  alias: string;
  modelPath: string;
};

type ManagedSession = ManagedServerHandle & { process: ChildProcess };

let currentSession: ManagedSession | null = null;

const DEFAULT_EXECUTABLE_CANDIDATES = ['llama-server', '/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server'];

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to acquire a free port')));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Poll GET /health until it returns HTTP 200. The llama-server TCP port opens
 * well before the model finishes loading, during which every endpoint returns
 * 503, so readiness must be checked at the HTTP layer rather than via TCP.
 */
function waitForHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = (): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`llama-server did not become healthy within ${Math.round(timeoutMs / 1000)}s`));
      } else {
        setTimeout(attempt, 500);
      }
    };
    attempt();
  });
}

function isPathInsideRoots(modelPath: string, allowedRoots: readonly string[]): boolean {
  const resolved = path.resolve(modelPath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolved);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}

function resolveExecutable(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    // Absolute/relative paths must exist on disk; bare command names are left for
    // PATH resolution by the spawned shell environment.
    if (candidate.includes(path.sep)) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  return null;
}

/**
 * Stop the currently managed llama-server, if any.
 */
export function stopManagedLlamaServer(): void {
  if (currentSession) {
    try {
      currentSession.process.kill();
    } catch {
      /* already exited */
    }
    currentSession = null;
  }
}

/**
 * Current managed server handle, or null when nothing is running.
 */
export function getManagedServerStatus(): ManagedServerHandle | null {
  if (!currentSession) return null;
  const { process: _process, ...handle } = currentSession;
  return handle;
}

/**
 * Spawn a managed llama-server for the given GGUF model and wait until healthy.
 *
 * Enforces that `modelPath` lives inside one of `allowedRoots` before doing any
 * work, so a crafted IPC payload cannot launch an arbitrary file. Swaps out any
 * previously running managed server (one model at a time).
 */
export async function startManagedLlamaServer({
  modelPath,
  allowedRoots,
  executableCandidates = DEFAULT_EXECUTABLE_CANDIDATES,
  contextSize = 4096,
  gpuLayers = 99,
  readinessTimeoutMs = 180_000,
}: {
  modelPath: string;
  allowedRoots: readonly string[];
  executableCandidates?: readonly string[];
  contextSize?: number;
  gpuLayers?: number;
  readinessTimeoutMs?: number;
}): Promise<ManagedServerHandle> {
  if (!isPathInsideRoots(modelPath, allowedRoots)) {
    throw new Error(`Refusing to load "${modelPath}": it is outside the configured local model directories`);
  }

  const executable = resolveExecutable(executableCandidates);
  if (!executable) {
    throw new Error(
      'llama-server executable not found. Install llama.cpp (e.g. `brew install llama.cpp`) and try again.'
    );
  }

  // One model at a time: stop any previous managed server before starting a new one.
  stopManagedLlamaServer();

  const alias = path.basename(modelPath, path.extname(modelPath));
  const port = await findFreePort();
  const args = [
    '-m',
    modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--alias',
    alias,
    '-ngl',
    String(gpuLayers),
    '-c',
    String(contextSize),
  ];

  const child = spawn(executable, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: getEnhancedEnv(),
  });

  const session: ManagedSession = {
    process: child,
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    pid: child.pid ?? -1,
    alias,
    modelPath,
  };
  currentSession = session;

  let spawnError: Error | null = null;
  child.on('error', (err) => {
    spawnError = err instanceof Error ? err : new Error(String(err));
  });
  child.on('exit', () => {
    if (currentSession === session) currentSession = null;
  });

  try {
    await waitForHealthy(port, readinessTimeoutMs);
  } catch (err) {
    stopManagedLlamaServer();
    if (spawnError) {
      throw new Error(`Failed to launch llama-server: ${spawnError.message}`, { cause: spawnError });
    }
    throw err;
  }

  const { process: _process, ...handle } = session;
  return handle;
}
