/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Supported platform identifiers for whisper-server lookup. */
export type WhisperServerPlatform = NodeJS.Platform;

export type ResolveWhisperServerInput = {
  platform: WhisperServerPlatform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  /** User-picked absolute path (`whisperLocal.executablePath`); tried first when set. */
  configuredPath?: string;
  /** Injected existence predicate so the resolver stays pure and unit-testable. */
  exists: (candidate: string) => boolean;
};

/** Base name of the whisper.cpp HTTP server binary. */
const BINARY_BASE_NAME = 'whisper-server';

function binaryName(platform: WhisperServerPlatform): string {
  return platform === 'win32' ? `${BINARY_BASE_NAME}.exe` : BINARY_BASE_NAME;
}

function join(platform: WhisperServerPlatform, dir: string, file: string): string {
  const sep = platform === 'win32' ? '\\' : '/';
  const trimmed = dir.endsWith(sep) || dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${file}`;
}

/**
 * Directories searched after PATH, per platform. These are the locations the
 * common installers (Homebrew, manual release unzip) use.
 */
function platformExtraDirectories(platform: WhisperServerPlatform, env: NodeJS.ProcessEnv, homeDir: string): string[] {
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin', '/usr/local/bin', join(platform, homeDir, '.local/bin')];
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(platform, homeDir, 'AppData\\Local');
    const userProfile = env.USERPROFILE ?? homeDir;
    return [`${localAppData}\\whisper.cpp`, `${userProfile}\\scoop\\shims`, 'C:\\Program Files\\whisper.cpp'];
  }
  return ['/usr/local/bin', '/usr/bin', join(platform, homeDir, '.local/bin'), '/snap/bin'];
}

/**
 * Locate the `whisper-server` executable without shelling out.
 *
 * Order: the user-configured path, then every `PATH` entry, then the well-known
 * install directories for the given platform. Returns `null` when nothing on
 * disk matches — callers surface install guidance instead of guessing.
 */
export function resolveWhisperServerExecutable(input: ResolveWhisperServerInput): string | null {
  const { platform, env, homeDir, configuredPath, exists } = input;
  const file = binaryName(platform);
  const delimiter = platform === 'win32' ? ';' : ':';

  const candidates: string[] = [];
  if (configuredPath) candidates.push(configuredPath);
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
