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
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { resolveLlamaServerExecutable } from '@process/services/localModels/executableResolution';
import {
  isValidExecutablePath,
  LLAMA_SERVER_BASENAMES,
  validateExecutablePath,
} from '@process/services/security/executableValidation';
import { GGUF_MODEL_EXTENSIONS, validateModelFile } from '@process/services/security/modelPathValidation';

/** Context window for the embedding server; embeddings never need a large one. */
export const EMBEDDING_CONTEXT_SIZE = 2048;
/** Offload everything by default; the embedding models in the catalog are tiny. */
export const EMBEDDING_GPU_LAYERS = 99;

/** Handle to the running embedding server. */
export type EmbeddingRuntimeHandle = {
  port: number;
  /** OpenAI-compatible base URL, e.g. `http://127.0.0.1:8123/v1`. */
  baseUrl: string;
  pid: number;
  modelPath: string;
};

type EmbeddingSession = EmbeddingRuntimeHandle & { process: ChildProcess };

let currentSession: EmbeddingSession | null = null;

const MAX_CAPTURED_STDERR = 8_000;

/**
 * Command-line arguments for a dedicated embedding server.
 *
 * Kept separate from the chat runtime's argument builder because only one
 * managed chat server may run at a time; semantic indexing needs its own.
 */
export function buildEmbeddingServerArgs({
  modelPath,
  port,
  contextSize = EMBEDDING_CONTEXT_SIZE,
  gpuLayers = EMBEDDING_GPU_LAYERS,
}: {
  modelPath: string;
  port: number;
  contextSize?: number;
  gpuLayers?: number;
}): string[] {
  return [
    '-m',
    modelPath,
    '--embedding',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '-c',
    String(contextSize),
    '-ngl',
    String(gpuLayers),
  ];
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
 * Poll GET /health until it returns HTTP 200. The TCP port opens well before the
 * model finishes loading, during which every endpoint answers 503, so readiness
 * has to be checked at the HTTP layer.
 */
function waitForHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = (): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`Embedding server did not become healthy within ${Math.round(timeoutMs / 1000)}s`));
      } else {
        setTimeout(attempt, 500);
      }
    };
    attempt();
  });
}

/** Locate `llama-server`, preferring the user-configured path. */
function findExecutable(configuredPath?: string): string | null {
  return resolveLlamaServerExecutable({
    platform: process.platform,
    env: getEnhancedEnv(),
    homeDir: os.homedir(),
    configuredPath,
    exists: existsSync,
    isValidExecutable: (candidate) => isValidExecutablePath(candidate, { allowedBasenames: LLAMA_SERVER_BASENAMES }),
  });
}

/** Handle of the running embedding server, or null when none is running. */
export function getEmbeddingRuntimeStatus(): EmbeddingRuntimeHandle | null {
  if (!currentSession) return null;
  const { process: _process, ...handle } = currentSession;
  return handle;
}

/** Terminate the embedding server, if any. Safe to call when nothing is running. */
export function stopEmbeddingRuntime(): void {
  if (!currentSession) return;
  try {
    currentSession.process.kill();
  } catch {
    /* already exited */
  }
  currentSession = null;
}

/**
 * Start a dedicated `llama-server --embedding` for `modelPath` and wait until it
 * reports healthy. Re-uses the running server when it already serves that model.
 *
 * `modelPath` comes from `semanticSearch.embeddingModelPath`, which any IPC
 * caller can set, so it is jailed to `allowedRoots` here as well as at the
 * bridge — this function must never spawn a server for an arbitrary file.
 *
 * @throws When the model is outside `allowedRoots`, `llama-server` cannot be
 *   found, or the process dies before it is healthy.
 */
export async function startEmbeddingRuntime({
  modelPath,
  allowedRoots,
  executablePath,
  contextSize = EMBEDDING_CONTEXT_SIZE,
  gpuLayers = EMBEDDING_GPU_LAYERS,
  readinessTimeoutMs = 180_000,
  spawnFn = spawn,
}: {
  modelPath: string;
  /** Directories the embedding model must live under. */
  allowedRoots: readonly string[];
  /** User-configured `llama-server` path, tried before PATH and platform defaults. */
  executablePath?: string;
  contextSize?: number;
  gpuLayers?: number;
  readinessTimeoutMs?: number;
  /** Injected for tests; defaults to `child_process.spawn`. */
  spawnFn?: typeof spawn;
}): Promise<EmbeddingRuntimeHandle> {
  validateModelFile(modelPath, { allowedRoots, allowedExtensions: GGUF_MODEL_EXTENSIONS });

  if (currentSession && currentSession.modelPath === modelPath) {
    const { process: _process, ...handle } = currentSession;
    return handle;
  }
  stopEmbeddingRuntime();

  const executable = findExecutable(executablePath);
  if (!executable) {
    throw new Error(
      'llama-server executable not found. Install llama.cpp (e.g. `brew install llama.cpp`) and try again.'
    );
  }
  validateExecutablePath(executable, { allowedBasenames: LLAMA_SERVER_BASENAMES });

  const port = await findFreePort();
  const child = spawnFn(executable, buildEmbeddingServerArgs({ modelPath, port, contextSize, gpuLayers }), {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: getEnhancedEnv(),
  });

  let stderrTail = '';
  child.stderr?.setEncoding('utf-8');
  child.stderr?.on('data', (chunk: string | Buffer) => {
    stderrTail = (stderrTail + String(chunk)).slice(-MAX_CAPTURED_STDERR);
  });

  const session: EmbeddingSession = {
    process: child,
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    pid: child.pid ?? -1,
    modelPath,
  };
  currentSession = session;
  child.on('exit', () => {
    if (currentSession === session) currentSession = null;
  });

  let rejectStartup: (error: Error) => void = () => {};
  const onStartupError = (err: Error): void =>
    rejectStartup(new Error(`Failed to launch llama-server: ${err.message}`));
  const onStartupExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    rejectStartup(new Error(`Embedding server exited before becoming healthy (${reason})\n${stderrTail.trim()}`));
  };
  const processFailure = new Promise<never>((_resolve, reject) => {
    rejectStartup = reject;
    child.once('error', onStartupError);
    child.once('exit', onStartupExit);
  });

  try {
    await Promise.race([waitForHealthy(port, readinessTimeoutMs), processFailure]);
  } catch (error) {
    stopEmbeddingRuntime();
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    child.off('error', onStartupError);
    child.off('exit', onStartupExit);
  }

  const { process: _process, ...handle } = session;
  return handle;
}
