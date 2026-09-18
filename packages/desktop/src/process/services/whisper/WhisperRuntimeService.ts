/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import {
  buildWhisperExecutableCandidates,
  buildWhisperServerArgs,
  resolveWhisperExecutable,
} from './whisperExecutable';

/** Resolved handle to the running `whisper-server`. */
export type WhisperServerHandle = {
  baseUrl: string;
  modelPath: string;
  pid: number;
  port: number;
};

type WhisperSession = WhisperServerHandle & { process: ChildProcess };

const MAX_CAPTURED_STDERR = 12_000;

let currentSession: WhisperSession | null = null;

/** A candidate counts as installed only when it is a regular, executable file. */
export function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Absolute path of the installed `whisper-server`, or null when absent. */
export function resolveInstalledWhisperExecutable(): string | null {
  return resolveWhisperExecutable(
    buildWhisperExecutableCandidates({
      platform: process.platform,
      home: os.homedir(),
      pathEnv: getEnhancedEnv().PATH ?? process.env.PATH ?? '',
    }),
    isExecutableFile
  );
}

/**
 * Same jail as `LocalModelRuntimeService.isPathInsideRoots`: a model path is
 * only accepted when it resolves inside one of the allowed roots, so a crafted
 * IPC payload cannot make the process side read an arbitrary file.
 */
export function isPathInsideRoots(modelPath: string, allowedRoots: readonly string[]): boolean {
  const resolved = path.resolve(modelPath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolved);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });
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
 * whisper.cpp's server README documents no health endpoint — only `/inference`
 * and `/load`, plus the static `--public` folder mounted at `/`. So readiness
 * is "the HTTP listener answers at all": any response to `GET /` means the
 * model finished loading, because the listener is only bound afterwards.
 */
function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const retry = (): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`whisper-server did not become ready within ${Math.round(timeoutMs / 1000)}s`));
      } else {
        setTimeout(attempt, 500);
      }
    };

    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        if (typeof res.statusCode === 'number' && res.statusCode < 500) {
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

    attempt();
  });
}

function withCapturedStderr(message: string, stderrTail: string, cause?: Error): Error {
  const stderr = stderrTail.trim();
  const fullMessage = stderr ? `${message}\nwhisper-server stderr:\n${stderr}` : message;
  return cause ? new Error(fullMessage, { cause }) : new Error(fullMessage);
}

/** Stop the managed `whisper-server`, if any. Safe to call on app quit. */
export function stopWhisperServer(): void {
  if (currentSession) {
    try {
      currentSession.process.kill();
    } catch {
      /* already exited */
    }
    currentSession = null;
  }
}

/** Current handle, or null when nothing is running. */
export function getWhisperServerStatus(): WhisperServerHandle | null {
  if (!currentSession) return null;
  const { process: _process, ...handle } = currentSession;
  return handle;
}

/**
 * Spawn `whisper-server` for `modelPath` and resolve once it answers HTTP.
 * Only one server runs at a time; starting a new model swaps the old one out.
 */
export async function startWhisperServer({
  modelPath,
  allowedRoots,
  executable,
  language,
  translate,
  threads,
  readinessTimeoutMs = 180_000,
}: {
  modelPath: string;
  allowedRoots: readonly string[];
  executable?: string | null;
  language?: string;
  translate?: boolean;
  threads?: number;
  readinessTimeoutMs?: number;
}): Promise<WhisperServerHandle> {
  if (!isPathInsideRoots(modelPath, allowedRoots)) {
    throw new Error(`Refusing to load "${modelPath}": it is outside the allowed whisper model directories`);
  }

  const resolvedExecutable = executable ?? resolveInstalledWhisperExecutable();
  if (!resolvedExecutable) {
    throw new Error('whisper-server executable not found. Install whisper.cpp (e.g. `brew install whisper.cpp`).');
  }

  stopWhisperServer();

  const port = await findFreePort();
  const args = buildWhisperServerArgs({ modelPath, port, language, translate, threads });
  const child = spawn(resolvedExecutable, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: getEnhancedEnv(),
  });

  let stderrTail = '';
  child.stderr?.setEncoding('utf-8');
  child.stderr?.on('data', (chunk: string | Buffer) => {
    stderrTail = (stderrTail + String(chunk)).slice(-MAX_CAPTURED_STDERR);
  });

  const session: WhisperSession = {
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
    rejectStartup(withCapturedStderr(`whisper-server exited before becoming ready (${reason})`, stderrTail));
  };
  const processFailure = new Promise<never>((_resolve, reject) => {
    rejectStartup = reject;
    child.once('error', onStartupError);
    child.once('exit', onStartupExit);
  });

  try {
    await Promise.race([waitForReady(port, readinessTimeoutMs), processFailure]);
  } catch (err) {
    stopWhisperServer();
    if (err instanceof Error && err.message.includes('whisper-server stderr:')) throw err;
    if (err instanceof Error) throw withCapturedStderr(err.message, stderrTail, err);
    throw withCapturedStderr(String(err), stderrTail);
  } finally {
    child.off('error', onStartupError);
    child.off('exit', onStartupExit);
  }

  const { process: _process, ...handle } = session;
  return handle;
}
