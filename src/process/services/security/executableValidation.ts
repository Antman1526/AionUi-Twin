/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { accessSync, constants as fsConstants, statSync, type Stats } from 'node:fs';
import path from 'node:path';

/** Accepted file names for the llama.cpp OpenAI-compatible server binary. */
export const LLAMA_SERVER_BASENAMES: readonly string[] = ['llama-server', 'llama-server.exe'];

/** Accepted file names for the whisper.cpp HTTP server binary. */
export const WHISPER_SERVER_BASENAMES: readonly string[] = ['whisper-server', 'whisper-server.exe'];

export type ExecutableValidationOptions = {
  /** File names the candidate is allowed to have, compared case-insensitively. */
  allowedBasenames: readonly string[];
  /** Defaults to the running platform; `win32` has no executable bit to check. */
  platform?: NodeJS.Platform;
  /** Injected for tests; defaults to `fs.statSync`. */
  statFn?: (target: string) => Stats;
  /** Injected for tests; defaults to `fs.accessSync`. */
  accessFn?: (target: string, mode: number) => void;
};

/** True when the candidate's file name is one of `allowedBasenames`. */
export function isAllowedExecutableName(candidate: string, allowedBasenames: readonly string[]): boolean {
  const name = path.basename(candidate.trim()).toLowerCase();
  return allowedBasenames.some((allowed) => allowed.toLowerCase() === name);
}

/**
 * Throw unless the candidate's file name is one of `allowedBasenames`.
 *
 * Used on its own for bare command names that the spawn environment resolves via
 * PATH, where there is no file on disk to stat yet.
 */
export function assertAllowedExecutableName(candidate: string, allowedBasenames: readonly string[]): void {
  if (!isAllowedExecutableName(candidate, allowedBasenames)) {
    throw new Error(`Refusing to run "${candidate}": only ${allowedBasenames.join(' or ')} may be launched`);
  }
}

/**
 * Validate a path before it is handed to `spawn`.
 *
 * IPC payloads are untrusted, so a configured executable path must be an
 * existing, executable, regular file whose file name is one of the binaries this
 * app is allowed to manage — otherwise `localModel.setExecutablePath` would be an
 * arbitrary-command-execution primitive.
 *
 * @returns The resolved absolute path.
 * @throws When the candidate is empty, misnamed, missing, not a file, or not executable.
 */
export function validateExecutablePath(candidate: string, options: ExecutableValidationOptions): string {
  const trimmed = candidate.trim();
  if (!trimmed) throw new Error('Refusing to run an empty executable path');

  const resolved = path.resolve(trimmed);
  assertAllowedExecutableName(resolved, options.allowedBasenames);

  const statFn = options.statFn ?? statSync;
  let stat: Stats;
  try {
    stat = statFn(resolved);
  } catch {
    throw new Error(`Refusing to run "${resolved}": no such file`);
  }
  if (!stat.isFile()) {
    throw new Error(`Refusing to run "${resolved}": not a regular file`);
  }

  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    const accessFn = options.accessFn ?? accessSync;
    try {
      accessFn(resolved, fsConstants.X_OK);
    } catch {
      throw new Error(`Refusing to run "${resolved}": not executable`);
    }
  }
  return resolved;
}

/** Non-throwing form of {@link validateExecutablePath}. */
export function isValidExecutablePath(candidate: string, options: ExecutableValidationOptions): boolean {
  try {
    validateExecutablePath(candidate, options);
    return true;
  } catch {
    return false;
  }
}
