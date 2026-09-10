/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
export type LocalRuntimeProvider = IProvider & { useModel: string; use_model?: string };

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
    base_url: baseUrl,
    api_key: '',
    models,
    useModel: models[0] ?? '',
    use_model: models[0] ?? '',
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
const DEFAULT_MLX_CANDIDATES = [
  'mlx_lm.server',
  '/opt/homebrew/bin/mlx_lm.server',
  path.join(process.env.HOME || '', '.local/bin/mlx_lm.server'),
  path.join(process.env.HOME || '', 'Library/Python/3.11/bin/mlx_lm.server'),
  path.join(process.env.HOME || '', 'Library/Python/3.12/bin/mlx_lm.server'),
  path.join(process.env.HOME || '', 'Library/Python/3.10/bin/mlx_lm.server'),
];
const MAX_CAPTURED_STDERR = 12_000;

export function buildLlamaServerArgs({
  modelPath,
  port,
  alias,
  contextSize,
  gpuLayers,
  reasoning,
}: {
  modelPath: string;
  port: number;
  alias: string;
  contextSize: number;
  gpuLayers: number;
  reasoning?: 'off' | 'on';
}): string[] {
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
  if (reasoning) {
    args.push('--reasoning', reasoning);
  }
  return args;
}

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
 * Poll /health or /v1/models until it returns HTTP 200.
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
          checkModelsEndpoint();
        }
      });

      const checkModelsEndpoint = (): void => {
        const req2 = http.get({ host: '127.0.0.1', port, path: '/v1/models', timeout: 2000 }, (res2) => {
          res2.resume();
          if (res2.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        });
        req2.on('error', retry);
        req2.on('timeout', () => {
          req2.destroy();
          retry();
        });
      };

      req.on('error', () => checkModelsEndpoint());
      req.on('timeout', () => {
        req.destroy();
        checkModelsEndpoint();
      });
    };

    const retry = (): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`Local model server did not become healthy within ${Math.round(timeoutMs / 1000)}s`));
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
    return !relative.startsWith('..') && !path.isAbsolute(relative);
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

function withCapturedStderr(message: string, stderrTail: string, cause?: Error): Error {
  const stderr = stderrTail.trim();
  const fullMessage = stderr ? `${message}\nllama-server stderr:\n${stderr}` : message;
  return cause ? new Error(fullMessage, { cause }) : new Error(fullMessage);
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
  contextSize = 16_384,
  gpuLayers = 99,
  readinessTimeoutMs = 180_000,
  reasoning,
}: {
  modelPath: string;
  allowedRoots: readonly string[];
  executableCandidates?: readonly string[];
  contextSize?: number;
  gpuLayers?: number;
  readinessTimeoutMs?: number;
  reasoning?: 'off' | 'on';
}): Promise<ManagedServerHandle> {
  if (!isPathInsideRoots(modelPath, allowedRoots)) {
    throw new Error(`Refusing to load "${modelPath}": it is outside the configured local model directories`);
  }

  // One model at a time: stop any previous managed server before starting a new one.
  stopManagedLlamaServer();

  const alias = path.basename(modelPath, path.extname(modelPath));
  const port = await findFreePort();

  const isMlx = existsSync(modelPath) && (statSync(modelPath).isDirectory() || modelPath.endsWith('.safetensors'));
  let executable: string | null = null;
  let args: string[] = [];

  if (isMlx) {
    executable = resolveExecutable(DEFAULT_MLX_CANDIDATES);
    if (!executable) {
      throw new Error(
        'mlx_lm.server executable not found. Install mlx-lm by running `pip install mlx-lm` to serve Apple Silicon native MLX models.'
      );
    }
    args = ['--model', modelPath, '--port', String(port)];
  } else {
    executable = resolveExecutable(executableCandidates);
    if (!executable) {
      throw new Error(
        'llama-server executable not found. Install llama.cpp (e.g. `brew install llama.cpp`) and try again.'
      );
    }
    args = buildLlamaServerArgs({ modelPath, port, alias, contextSize, gpuLayers, reasoning });
  }

  const child = spawn(executable, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: getEnhancedEnv(),
  });
  let stderrTail = '';
  child.stderr?.setEncoding('utf-8');
  child.stderr?.on('data', (chunk: string | Buffer) => {
    stderrTail = (stderrTail + String(chunk)).slice(-MAX_CAPTURED_STDERR);
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

  child.on('exit', () => {
    if (currentSession === session) currentSession = null;
  });

  let rejectStartup: (error: Error) => void = () => {};
  const onStartupError = (err: Error): void => {
    rejectStartup(withCapturedStderr(`Failed to launch llama-server: ${err.message}`, stderrTail, err));
  };
  const onStartupExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    rejectStartup(withCapturedStderr(`llama-server exited before becoming healthy (${reason})`, stderrTail));
  };
  const processFailure = new Promise<never>((_resolve, reject) => {
    rejectStartup = reject;
    child.once('error', onStartupError);
    child.once('exit', onStartupExit);
  });

  try {
    await Promise.race([waitForHealthy(port, readinessTimeoutMs), processFailure]);
    child.off('error', onStartupError);
    child.off('exit', onStartupExit);
  } catch (err) {
    child.off('error', onStartupError);
    child.off('exit', onStartupExit);
    stopManagedLlamaServer();
    if (err instanceof Error && err.message.includes('llama-server stderr:')) throw err;
    if (err instanceof Error) throw withCapturedStderr(err.message, stderrTail, err);
    throw withCapturedStderr(String(err), stderrTail);
  }

  const { process: _process, ...handle } = session;
  return handle;
}
