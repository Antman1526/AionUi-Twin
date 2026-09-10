/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeModelDirectories } from '@/common/utils/localModelProviders';

/** Environment variable used to add extra model directories without editing config. */
export const MODEL_DIRS_ENV = 'AIONUI_MODEL_DIRS';

/**
 * Standard, machine-agnostic locations where local model files commonly live.
 * Derived from the current user's home directory and platform, never hardcoded
 * to a specific machine.
 */
function standardModelDirectories(home: string): string[] {
  const dirs = [
    path.join(home, 'AI_Models', 'GGUF'),
    path.join(home, 'AI_Models'),
    path.join(home, 'Models', 'GGUF'),
    path.join(home, 'Models'),
    path.join(home, 'Desktop', 'AI_Models', 'GGUF'),
    path.join(home, 'Desktop', 'AI_Models'),
    path.join(home, '.ollama', 'models'),
    path.join(home, '.cache', 'lm-studio', 'models'),
    path.join(home, '.lmstudio', 'models'),
  ];
  dirs.push(
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'llama.cpp')
      : path.join(home, '.cache', 'llama.cpp')
  );
  return dirs;
}

/**
 * Directories listed in the {@link MODEL_DIRS_ENV} environment variable, split on
 * the platform path delimiter (`:` on macOS/Linux, `;` on Windows).
 */
function envModelDirectories(): string[] {
  return (process.env[MODEL_DIRS_ENV] ?? '').split(path.delimiter);
}

/**
 * Effective default model directories when the user has not configured any.
 *
 * Combines explicit {@link MODEL_DIRS_ENV} entries (always kept) with standard
 * locations that actually exist (existence-filtered so absent locations don't
 * clutter the UI). User-configured directories — added via Settings — take
 * precedence over these and are handled by the caller.
 */
export function getDefaultLocalModelDirectories(): string[] {
  const home = os.homedir();
  const envDirs = normalizeModelDirectories(envModelDirectories());
  const existingStandard = standardModelDirectories(home).filter((dir) => existsSync(dir));
  return normalizeModelDirectories([...envDirs, ...existingStandard]);
}
