/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { realpathSync, statSync, type Stats } from 'node:fs';
import path from 'node:path';

/** Extensions accepted for llama.cpp chat and embedding models. */
export const GGUF_MODEL_EXTENSIONS: readonly string[] = ['.gguf'];

/** Extensions accepted for whisper.cpp models (ggml `.bin`, plus newer `.gguf`). */
export const WHISPER_MODEL_EXTENSIONS: readonly string[] = ['.bin', '.gguf'];

export type ModelFileValidationOptions = {
  /** Directories the model file must live under. An empty list rejects everything. */
  allowedRoots: readonly string[];
  /** File extensions the model is allowed to have, compared case-insensitively. */
  allowedExtensions: readonly string[];
  /** Wording for the "outside …" error, e.g. `the whisper model directory`. */
  allowedDescription?: string;
  /** Injected for tests; defaults to `fs.statSync`. */
  statFn?: (target: string) => Stats;
  /** Injected for tests; defaults to `fs.realpathSync`. */
  realpathFn?: (target: string) => string;
};

const DEFAULT_DESCRIPTION = 'the configured local model directories';

/** Canonical form of a directory: its real path when it exists, else the resolved path. */
function canonicalDirectory(target: string, realpathFn: (value: string) => string): string {
  try {
    return realpathFn(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

/**
 * Canonical form of a file path: `..` segments removed and the containing
 * directory's symlinks resolved, so a symlinked sub-directory cannot smuggle a
 * path out of an allowed root.
 */
export function canonicalizeFilePath(filePath: string, realpathFn: (value: string) => string = realpathSync): string {
  const resolved = path.resolve(filePath);
  return path.join(canonicalDirectory(path.dirname(resolved), realpathFn), path.basename(resolved));
}

/**
 * True when `filePath` resolves to a location strictly inside one of `allowedRoots`.
 * A path equal to a root is not "inside" it — roots are directories, not files.
 */
export function isPathInsideRoots(
  filePath: string,
  allowedRoots: readonly string[],
  realpathFn: (value: string) => string = realpathSync
): boolean {
  const canonical = canonicalizeFilePath(filePath, realpathFn);
  return allowedRoots.some((root) => {
    const relative = path.relative(canonicalDirectory(root, realpathFn), canonical);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}

/**
 * Validate a model file that is about to be passed to a spawned server.
 *
 * IPC payloads are untrusted: without this jail a crafted `modelPath` would let
 * any authenticated caller point a managed server at an arbitrary file.
 *
 * @returns The canonical absolute path of the model file.
 * @throws When the model is outside every allowed root, missing, not a regular
 *   file, or does not carry an accepted extension.
 */
export function validateModelFile(modelPath: string, options: ModelFileValidationOptions): string {
  const trimmed = modelPath.trim();
  if (!trimmed) throw new Error('Refusing to load an empty model path');

  const realpathFn = options.realpathFn ?? realpathSync;
  const canonical = canonicalizeFilePath(trimmed, realpathFn);
  const description = options.allowedDescription ?? DEFAULT_DESCRIPTION;

  if (!isPathInsideRoots(trimmed, options.allowedRoots, realpathFn)) {
    throw new Error(`Refusing to load "${modelPath}": it is outside ${description}`);
  }

  const statFn = options.statFn ?? statSync;
  let stat: Stats;
  try {
    stat = statFn(canonical);
  } catch {
    throw new Error(`Refusing to load "${modelPath}": no such file`);
  }
  if (!stat.isFile()) {
    throw new Error(`Refusing to load "${modelPath}": not a regular file`);
  }

  const extension = path.extname(canonical).toLowerCase();
  if (!options.allowedExtensions.some((allowed) => allowed.toLowerCase() === extension)) {
    throw new Error(`Refusing to load "${modelPath}": expected a ${options.allowedExtensions.join(' or ')} file`);
  }
  return canonical;
}
