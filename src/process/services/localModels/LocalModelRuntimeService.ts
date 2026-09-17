/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import {
  assertAllowedExecutableName,
  isValidExecutablePath,
  LLAMA_SERVER_BASENAMES,
  validateExecutablePath,
} from '@process/services/security/executableValidation';
import { GGUF_MODEL_EXTENSIONS, validateModelFile } from '@process/services/security/modelPathValidation';
import { resolveLlamaServerExecutable } from './executableResolution';
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

/**
 * Reported when a managed llama-server process exits after it had become healthy.
 * `expected: false` means the process died on its own — the caller must drop the
 * managed provider and surface the failure.
 */
export type ManagedServerExit = {
  expected: boolean;
  modelPath: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
};

type ManagedSession = ManagedServerHandle & {
  process: ChildProcess;
  /** Set by {@link stopManagedLlamaServer} so its exit is not reported as a crash. */
  expectedStop: boolean;
  /** Only exits after a successful health check are reported; startup failures reject the start promise. */
  ready: boolean;
};

let currentSession: ManagedSession | null = null;

const MAX_CAPTURED_STDERR = 12_000;

export function buildLlamaServerArgs({
  modelPath,
  port,
  alias,
  contextSize,
  gpuLayers,
  reasoning,
  embedding,
}: {
  modelPath: string;
  port: number;
  alias: string;
  contextSize: number;
  gpuLayers: number;
  reasoning?: 'off' | 'on';
  embedding?: boolean;
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
  if (embedding) {
    args.push('--embedding');
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
 * Locate `llama-server` on this machine: the user-configured path first, then
 * PATH, then the platform's well-known install directories.
 */
export function findLlamaServerExecutable(configuredPath?: string): string | null {
  return resolveLlamaServerExecutable({
    platform: process.platform,
    env: getEnhancedEnv(),
    homeDir: os.homedir(),
    configuredPath,
    exists: existsSync,
    isValidExecutable: (candidate) => isValidExecutablePath(candidate, { allowedBasenames: LLAMA_SERVER_BASENAMES }),
  });
}

/**
 * Last line of defence before `spawn`: the resolved command must name the
 * llama-server binary, and — when it is a path rather than a bare command left
 * to PATH resolution — be an existing executable regular file.
 */
function assertLaunchableLlamaServer(executable: string): void {
  try {
    if (executable.includes(path.sep)) {
      validateExecutablePath(executable, { allowedBasenames: LLAMA_SERVER_BASENAMES });
    } else {
      assertAllowedExecutableName(executable, LLAMA_SERVER_BASENAMES);
    }
  } catch (error) {
    throw new Error(`Failed to launch llama-server: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
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
    currentSession.expectedStop = true;
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
  const { process: _process, expectedStop: _expectedStop, ready: _ready, ...handle } = currentSession;
  return handle;
}

/**
 * Spawn a managed llama-server for the given GGUF model and wait until healthy.
 *
 * Enforces that `modelPath` is an existing `.gguf` file inside one of
 * `allowedRoots`, and that the resolved executable really is `llama-server`, so
 * a crafted IPC payload cannot launch an arbitrary command or file. Swaps out
 * any previously running managed server (one model at a time).
 */
export async function startManagedLlamaServer({
  modelPath,
  allowedRoots,
  executableCandidates,
  executablePath,
  contextSize = 16_384,
  gpuLayers = 99,
  readinessTimeoutMs = 180_000,
  reasoning,
  embedding,
  onExit,
  spawnFn = spawn,
}: {
  modelPath: string;
  allowedRoots: readonly string[];
  /** Explicit candidate list; when omitted the platform resolver is used. */
  executableCandidates?: readonly string[];
  /** User-configured `llama-server` path, tried before PATH and the platform defaults. */
  executablePath?: string;
  contextSize?: number;
  gpuLayers?: number;
  readinessTimeoutMs?: number;
  reasoning?: 'off' | 'on';
  /** Pass `--embedding` so the server also exposes /v1/embeddings. */
  embedding?: boolean;
  /** Called when a server that had become healthy exits, expectedly or not. */
  onExit?: (exit: ManagedServerExit) => void;
  /** Injected for tests; defaults to `child_process.spawn`. */
  spawnFn?: typeof spawn;
}): Promise<ManagedServerHandle> {
  validateModelFile(modelPath, { allowedRoots, allowedExtensions: GGUF_MODEL_EXTENSIONS });

  const executable = executableCandidates
    ? resolveExecutable(executableCandidates)
    : findLlamaServerExecutable(executablePath);
  if (!executable) {
    throw new Error(
      'llama-server executable not found. Install llama.cpp (e.g. `brew install llama.cpp`) and try again.'
    );
  }
  assertLaunchableLlamaServer(executable);

  // One model at a time: stop any previous managed server before starting a new one.
  stopManagedLlamaServer();

  const alias = path.basename(modelPath, path.extname(modelPath));
  const port = await findFreePort();
  const args = buildLlamaServerArgs({ modelPath, port, alias, contextSize, gpuLayers, reasoning, embedding });

  const child = spawnFn(executable, args, {
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
    expectedStop: false,
    ready: false,
  };
  currentSession = session;

  child.on('exit', (code, signal) => {
    if (currentSession === session) currentSession = null;
    // Startup failures are surfaced by rejecting this call; only report exits of a
    // server the caller was already told about.
    if (!session.ready) return;
    session.ready = false;
    onExit?.({
      expected: session.expectedStop,
      modelPath: session.modelPath,
      exitCode: code,
      signal,
      stderrTail: stderrTail.trim(),
    });
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

  session.ready = true;
  const { process: _process, expectedStop: _expectedStop, ready: _ready, ...handle } = session;
  return handle;
}
