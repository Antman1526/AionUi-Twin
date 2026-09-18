/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

/**
 * Filesystem probe injected so executable resolution stays a pure function in
 * tests (no real binary required).
 */
export type ExecutableProbe = (candidate: string) => boolean;

export const WHISPER_SERVER_BINARY = 'whisper-server';

/**
 * Build the ordered lookup list for `whisper-server`: every directory on PATH
 * first (that is where `brew install whisper.cpp` lands it), then the usual
 * manual-install locations.
 */
export function buildWhisperExecutableCandidates({
  platform,
  home,
  pathEnv,
}: {
  platform: NodeJS.Platform;
  home: string;
  pathEnv: string;
}): string[] {
  const isWindows = platform === 'win32';
  const binary = isWindows ? `${WHISPER_SERVER_BINARY}.exe` : WHISPER_SERVER_BINARY;
  const delimiter = isWindows ? ';' : ':';
  const pathDirs = pathEnv.split(delimiter).filter(Boolean);
  const extraDirs = isWindows
    ? [path.join(home, 'AppData', 'Local', 'Programs', 'whisper.cpp')]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin')];

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const dir of [...pathDirs, ...extraDirs]) {
    const candidate = path.join(dir, binary);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * First candidate that is a regular, executable file. Unlike the llama.cpp
 * resolver we never fall back to a bare command name: `whisper-server` is
 * optional, and the settings UI needs a definitive "installed / not installed"
 * answer rather than a spawn that fails later with ENOENT.
 */
export function resolveWhisperExecutable(
  candidates: readonly string[],
  isExecutableFile: ExecutableProbe
): string | null {
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * CLI flags for `whisper-server`, all taken from
 * `examples/server/README.md` in whisper.cpp: `-m` model, `--host`, `--port`,
 * `-t` threads, `-l` language ('auto' to detect) and `-tr` to translate to
 * English.
 */
export function buildWhisperServerArgs({
  modelPath,
  port,
  host = '127.0.0.1',
  threads,
  language,
  translate,
}: {
  modelPath: string;
  port: number;
  host?: string;
  threads?: number;
  language?: string;
  translate?: boolean;
}): string[] {
  const args = ['-m', modelPath, '--host', host, '--port', String(port)];
  if (threads && threads > 0) {
    args.push('-t', String(Math.round(threads)));
  }
  args.push('-l', language?.trim() ? language.trim() : 'auto');
  if (translate) {
    args.push('-tr');
  }
  return args;
}
