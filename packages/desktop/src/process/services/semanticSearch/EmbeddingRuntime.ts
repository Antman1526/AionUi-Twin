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
import type { SemanticSearchSource } from '@/common/config/storage';
import { getEnhancedEnv } from '@process/utils/shellEnv';

/**
 * Embedding server this module talks to.
 *
 * `managed: true` means we spawned the `llama-server --embedding` process and
 * own its lifetime. `managed: false` means the user pointed us at an already
 * running loopback OpenAI-compatible server (Ollama, LM Studio, ...).
 */
export type EmbeddingRuntimeHandle = {
  baseUrl: string;
  model: string;
  managed: boolean;
  modelPath?: string;
  port?: number;
};

type ManagedSession = EmbeddingRuntimeHandle & { process: ChildProcess };

/**
 * The general local-model runtime (LocalModelRuntimeService) serves exactly one
 * chat model at a time. Embeddings therefore need a server of their own, tracked
 * separately here so loading a chat model never evicts the index.
 */
let currentSession: ManagedSession | null = null;

const DEFAULT_EXECUTABLE_CANDIDATES = ['llama-server', '/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server'];
const MAX_CAPTURED_STDERR = 12_000;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

/** Filename fragments that mark a GGUF file as an embedding model. */
const EMBEDDING_NAME_HINTS = ['embed', 'bge-', 'gte-', 'e5-', 'minilm', 'nomic-embed', 'jina-embed'];

/** Heuristic used by the settings picker to surface embedding models only. */
export function looksLikeEmbeddingModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBEDDING_NAME_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Only loopback endpoints are accepted for the "existing provider" source.
 * The base URL comes from config that IPC can write, so a remote host here
 * would turn the indexer into an SSRF primitive.
 */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return LOOPBACK_HOSTNAMES.has(url.hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

export function buildEmbeddingServerArgs({
  modelPath,
  port,
  alias,
  contextSize,
}: {
  modelPath: string;
  port: number;
  alias: string;
  contextSize: number;
}): string[] {
  // `--embedding` restricts the server to the embedding use case; pooling is
  // intentionally left unset so llama.cpp uses the model's own default.
  return [
    '-m',
    modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--alias',
    alias,
    '--embedding',
    '-c',
    String(contextSize),
  ];
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
    if (candidate.includes(path.sep) && existsSync(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep)) return candidate;
  }
  return null;
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

/** Poll /health, falling back to /v1/models, until one answers HTTP 200. */
function waitForHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const retry = (): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`Embedding server did not become healthy within ${Math.round(timeoutMs / 1000)}s`));
      } else {
        setTimeout(attempt, 500);
      }
    };

    function attempt(): void {
      const checkModelsEndpoint = (): void => {
        const modelsReq = http.get({ host: '127.0.0.1', port, path: '/v1/models', timeout: 2000 }, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry();
        });
        modelsReq.on('error', retry);
        modelsReq.on('timeout', () => {
          modelsReq.destroy();
          retry();
        });
      };

      const healthReq = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else checkModelsEndpoint();
      });
      healthReq.on('error', () => checkModelsEndpoint());
      healthReq.on('timeout', () => {
        healthReq.destroy();
        checkModelsEndpoint();
      });
    }

    attempt();
  });
}

/** Stop the managed embedding server, if one is running. */
export function stopEmbeddingRuntime(): void {
  if (!currentSession) return;
  try {
    currentSession.process.kill();
  } catch {
    /* already exited */
  }
  currentSession = null;
}

/** Handle for the running embedding server, or null. */
export function getEmbeddingRuntimeStatus(): EmbeddingRuntimeHandle | null {
  if (!currentSession) return null;
  const { process: _process, ...handle } = currentSession;
  return handle;
}

/**
 * Resolve an embedding endpoint for `source`, spawning `llama-server --embedding`
 * when the source is a local GGUF file. The model path is jailed to
 * `allowedRoots` before anything is spawned.
 */
export async function ensureEmbeddingRuntime({
  source,
  allowedRoots,
  executableCandidates = DEFAULT_EXECUTABLE_CANDIDATES,
  contextSize = 8_192,
  readinessTimeoutMs = 180_000,
}: {
  source: SemanticSearchSource;
  allowedRoots: readonly string[];
  executableCandidates?: readonly string[];
  contextSize?: number;
  readinessTimeoutMs?: number;
}): Promise<EmbeddingRuntimeHandle> {
  if (source.kind === 'provider') {
    if (!isLoopbackBaseUrl(source.baseUrl)) {
      throw new Error(`Refusing to use "${source.baseUrl}": only loopback embedding endpoints are allowed`);
    }
    stopEmbeddingRuntime();
    return { baseUrl: source.baseUrl.replace(/\/+$/, ''), model: source.model, managed: false };
  }

  if (!isPathInsideRoots(source.modelPath, allowedRoots)) {
    throw new Error(`Refusing to load "${source.modelPath}": it is outside the configured local model directories`);
  }

  if (currentSession && currentSession.modelPath === source.modelPath) {
    const { process: _process, ...handle } = currentSession;
    return handle;
  }
  stopEmbeddingRuntime();

  const executable = resolveExecutable(executableCandidates);
  if (!executable) {
    throw new Error('llama-server executable not found. Install llama.cpp (e.g. `brew install llama.cpp`).');
  }

  const alias = path.basename(source.modelPath, path.extname(source.modelPath));
  const port = await findFreePort();
  const child = spawn(executable, buildEmbeddingServerArgs({ modelPath: source.modelPath, port, alias, contextSize }), {
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
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: alias,
    managed: true,
    modelPath: source.modelPath,
    port,
  };
  currentSession = session;
  child.on('exit', () => {
    if (currentSession === session) currentSession = null;
  });

  let rejectStartup: (error: Error) => void = () => {};
  const describe = (message: string): Error =>
    new Error(stderrTail.trim() ? `${message}\nllama-server stderr:\n${stderrTail.trim()}` : message);
  const onStartupError = (err: Error): void => rejectStartup(describe(`Failed to launch llama-server: ${err.message}`));
  const onStartupExit = (code: number | null, signal: NodeJS.Signals | null): void =>
    rejectStartup(
      describe(
        `llama-server exited before becoming healthy (${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`})`
      )
    );
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

/**
 * Call the OpenAI-compatible `POST /v1/embeddings` endpoint.
 *
 * Request/response shape verified against the llama.cpp server README
 * (`tools/server/README.md`, "POST /v1/embeddings: OpenAI-compatible embeddings
 * API"): the body accepts `input` as a string or string array plus `model` and
 * `encoding_format`, and the response is the OpenAI envelope
 * `{ data: [{ embedding: number[], index: number }] }`.
 */
export async function requestEmbeddings({
  baseUrl,
  model,
  inputs,
  signal,
}: {
  baseUrl: string;
  model: string;
  inputs: readonly string[];
  signal?: AbortSignal;
}): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: [...inputs], encoding_format: 'float' }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as { data?: Array<{ embedding?: number[]; index?: number }> };
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length !== inputs.length) {
    throw new Error(`Embedding response returned ${rows.length} vectors for ${inputs.length} inputs`);
  }

  const ordered = rows.every((row) => typeof row.index === 'number')
    ? [...rows].toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : rows;

  return ordered.map((row) => {
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
      throw new Error('Embedding response contained an entry without a vector');
    }
    return row.embedding;
  });
}
