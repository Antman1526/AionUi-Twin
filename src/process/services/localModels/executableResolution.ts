/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Supported platform identifiers for llama-server lookup. */
export type LlamaServerPlatform = NodeJS.Platform;

export type ResolveLlamaServerInput = {
  platform: LlamaServerPlatform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  /** User-picked absolute path (`localModel.executablePath`); tried first when set. */
  configuredPath?: string;
  /** Injected existence predicate so the resolver stays pure and unit-testable. */
  exists: (candidate: string) => boolean;
  /**
   * Extra check applied to {@link configuredPath} only (the one candidate that
   * comes from an untrusted IPC payload). Injected so this module stays free of
   * `fs`; callers pass a real executable validator.
   */
  isValidExecutable?: (candidate: string) => boolean;
};

/** Base name of the llama.cpp OpenAI-compatible server binary. */
const BINARY_BASE_NAME = 'llama-server';

function binaryName(platform: LlamaServerPlatform): string {
  return platform === 'win32' ? `${BINARY_BASE_NAME}.exe` : BINARY_BASE_NAME;
}

/** Last path segment of `candidate`, splitting on the separators of `platform`. */
function baseNameOf(platform: LlamaServerPlatform, candidate: string): string {
  const segments = platform === 'win32' ? candidate.split(/[\\/]/) : candidate.split('/');
  return segments[segments.length - 1] ?? '';
}

/**
 * A configured path is only usable when it names the llama-server binary and
 * passes the caller's validator. Anything else is skipped so the resolver falls
 * through to PATH instead of handing an arbitrary command to the spawn site.
 */
function isUsableConfiguredPath(input: ResolveLlamaServerInput, candidate: string): boolean {
  const { platform, exists, isValidExecutable } = input;
  if (baseNameOf(platform, candidate).toLowerCase() !== binaryName(platform).toLowerCase()) return false;
  if (isValidExecutable && !isValidExecutable(candidate)) return false;
  return exists(candidate);
}

function join(platform: LlamaServerPlatform, dir: string, file: string): string {
  const sep = platform === 'win32' ? '\\' : '/';
  const trimmed = dir.endsWith(sep) || dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${file}`;
}

/**
 * Directories searched after PATH, per platform. These are the locations the
 * common installers (Homebrew, WinGet, Scoop, snap, manual release unzip) use.
 */
function platformExtraDirectories(platform: LlamaServerPlatform, env: NodeJS.ProcessEnv, homeDir: string): string[] {
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin', '/usr/local/bin', join(platform, homeDir, '.local/bin')];
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(platform, homeDir, 'AppData\\Local');
    const userProfile = env.USERPROFILE ?? homeDir;
    return [
      `${localAppData}\\llama.cpp`,
      `${localAppData}\\Microsoft\\WinGet\\Links`,
      `${userProfile}\\scoop\\shims`,
      'C:\\Program Files\\llama.cpp',
    ];
  }
  return ['/usr/local/bin', '/usr/bin', join(platform, homeDir, '.local/bin'), '/snap/bin'];
}

/**
 * Locate the `llama-server` executable without shelling out.
 *
 * Order: the user-configured path, then every `PATH` entry, then the well-known
 * install directories for the given platform. Returns `null` when nothing on
 * disk matches — callers surface install guidance instead of guessing.
 *
 * A configured path that is not a valid `llama-server` binary is skipped rather
 * than returned, so a crafted `localModel.executablePath` cannot reach `spawn`.
 */
export function resolveLlamaServerExecutable(input: ResolveLlamaServerInput): string | null {
  const { platform, env, homeDir, configuredPath, exists } = input;
  const file = binaryName(platform);
  const delimiter = platform === 'win32' ? ';' : ':';

  const candidates: string[] = [];
  if (configuredPath && isUsableConfiguredPath(input, configuredPath)) candidates.push(configuredPath);
  for (const entry of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (entry) candidates.push(join(platform, entry, file));
  }
  for (const dir of platformExtraDirectories(platform, env, homeDir)) {
    candidates.push(join(platform, dir, file));
  }

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}
