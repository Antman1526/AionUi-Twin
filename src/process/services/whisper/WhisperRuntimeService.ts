/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import {
  isValidExecutablePath,
  validateExecutablePath,
  WHISPER_SERVER_BASENAMES,
} from '@process/services/security/executableValidation';
import { validateModelFile, WHISPER_MODEL_EXTENSIONS } from '@process/services/security/modelPathValidation';
import { resolveWhisperServerExecutable } from './whisperExecutableResolution';

/** Resolved handle to a running managed whisper-server. */
export type WhisperServerHandle = {
  port: number;
  baseUrl: string;
  pid: number;
  modelPath: string;
};

type ManagedSession = WhisperServerHandle & { process: ChildProcess };

let currentSession: ManagedSession | null = null;

const MAX_CAPTURED_STDERR = 12_000;

/**
 * Build the `whisper-server` CLI arguments for the given model/port.
 *
 * Flag names verified against the whisper.cpp server README
 * (`examples/server/README.md`): `-m/--model`, `--host`, `--port`,
 * `-l/--language`.
 */
export function buildWhisperServerArgs({
  modelPath,
  port,
  host = '127.0.0.1',
  language,
}: {
  modelPath: string;
  port: number;
  host?: string;
  language?: string;
}): string[] {
  const args = ['-m', modelPath, '--host', host, '--port', String(port)];
  if (language) {
    args.push('-l', language);
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
 * Poll GET /health until it returns HTTP 200 (`{"status":"ok"}`). The server's
 * TCP port opens before the model finishes loading, during which `/health`
 * returns 503, so readiness must be checked at the HTTP layer.
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
        reject(new Error(`whisper-server did not become healthy within ${Math.round(timeoutMs / 1000)}s`));
      } else {
        setTimeout(attempt, 500);
      }
    };
    attempt();
  });
}

function withCapturedStderr(message: string, stderrTail: string, cause?: Error): Error {
  const stderr = stderrTail.trim();
  const fullMessage = stderr ? `${message}\nwhisper-server stderr:\n${stderr}` : message;
  return cause ? new Error(fullMessage, { cause }) : new Error(fullMessage);
}

/**
 * Locate the `whisper-server` executable on this machine, or `null` when not found.
 *
 * A configured path that is not a valid `whisper-server` binary is ignored, so a
 * crafted `tools.speechToText.whisperLocal.executablePath` cannot reach `spawn`.
 */
export function findWhisperServerExecutable(configuredPath?: string): string | null {
  const validConfigured =
    configuredPath && isValidExecutablePath(configuredPath, { allowedBasenames: WHISPER_SERVER_BASENAMES })
      ? configuredPath
      : undefined;
  return resolveWhisperServerExecutable({
    platform: process.platform,
    env: process.env,
    homeDir: os.homedir(),
    configuredPath: validConfigured,
    exists: (candidate) => {
      try {
        accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch {
        return existsSync(candidate);
      }
    },
  });
}

/** Stop the currently managed whisper-server, if any. */
export function stopManagedWhisperServer(): void {
  if (currentSession) {
    try {
      currentSession.process.kill();
    } catch {
      /* already exited */
    }
    currentSession = null;
  }
}

/** Current managed whisper-server handle, or null when nothing is running. */
export function getManagedWhisperServerStatus(): WhisperServerHandle | null {
  if (!currentSession) return null;
  const { process: _process, ...handle } = currentSession;
  return handle;
}

/**
 * Spawn a managed `whisper-server` for the given ggml model and wait until
 * healthy. Swaps out any previously running managed server (one model at a
 * time), matching the llama-server local-model runtime.
 *
 * `modelPath` arrives from an untrusted IPC payload, so it must be an existing
 * model file inside one of `allowedRoots` — normally the app's whisper model
 * directory — and the executable must really be `whisper-server`.
 */
export async function startManagedWhisperServer({
  modelPath,
  allowedRoots,
  executablePath,
  language,
  readinessTimeoutMs = 60_000,
}: {
  modelPath: string;
  /** Directories the whisper model must live under. */
  allowedRoots: readonly string[];
  executablePath?: string;
  language?: string;
  readinessTimeoutMs?: number;
}): Promise<WhisperServerHandle> {
  validateModelFile(modelPath, {
    allowedRoots,
    allowedExtensions: WHISPER_MODEL_EXTENSIONS,
    allowedDescription: 'the whisper model directory',
  });

  const executable = findWhisperServerExecutable(executablePath);
  if (!executable) {
    throw new Error(
      'whisper-server executable not found. Install whisper.cpp (e.g. `brew install whisper.cpp` on macOS) and try again.'
    );
  }
  validateExecutablePath(executable, { allowedBasenames: WHISPER_SERVER_BASENAMES });

  // One model at a time: stop any previous managed server before starting a new one.
  stopManagedWhisperServer();

  const port = await findFreePort();
  const args = buildWhisperServerArgs({ modelPath, port, language });

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
    baseUrl: `http://127.0.0.1:${port}`,
    pid: child.pid ?? -1,
    modelPath,
  };
  currentSession = session;

  child.on('exit', () => {
    if (currentSession === session) currentSession = null;
  });

  let rejectStartup: (error: Error) => void = () => {};
  const onStartupError = (err: Error): void => {
    rejectStartup(withCapturedStderr(`Failed to launch whisper-server: ${err.message}`, stderrTail, err));
  };
  const onStartupExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    rejectStartup(withCapturedStderr(`whisper-server exited before becoming healthy (${reason})`, stderrTail));
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
    stopManagedWhisperServer();
    if (err instanceof Error && err.message.includes('whisper-server stderr:')) throw err;
    if (err instanceof Error) throw withCapturedStderr(err.message, stderrTail, err);
    throw withCapturedStderr(String(err), stderrTail);
  }

  const { process: _process, ...handle } = session;
  return handle;
}

/** Default per-platform directory for downloaded whisper ggml models. */
export function getWhisperModelsDirectory(userDataPath: string): string {
  return path.join(userDataPath, 'whisper-models');
}
