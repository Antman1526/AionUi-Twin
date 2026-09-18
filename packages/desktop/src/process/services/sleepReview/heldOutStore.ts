/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeldOutPrompt } from '@/common/types/sleepReview';
import { writeFileAtomic } from './proposalStore';

const HELD_OUT_FILE = 'held-out-prompts.json';

/**
 * Where a workspace's held-out prompts live, or the app-wide fallback when the
 * review is not scoped to a workspace.
 *
 * Callers must have authorized `workspace` before passing it in.
 */
export function heldOutFilePath(globalDir: string, workspace?: string): string {
  return workspace ? path.join(path.resolve(workspace), '.aionui', HELD_OUT_FILE) : path.join(globalDir, HELD_OUT_FILE);
}

function toPrompts(value: unknown): HeldOutPrompt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): HeldOutPrompt[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { id, prompt, expected } = entry as Partial<HeldOutPrompt>;
    if (typeof id !== 'string' || !id || typeof prompt !== 'string' || !prompt.trim()) return [];
    return [{ id, prompt, ...(typeof expected === 'string' && expected ? { expected } : {}) }];
  });
}

/** Read the held-out set. A missing or malformed file reads as empty. */
export async function readHeldOutPrompts(globalDir: string, workspace?: string): Promise<HeldOutPrompt[]> {
  try {
    const raw = await fs.readFile(heldOutFilePath(globalDir, workspace), 'utf8');
    return toPrompts(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Replace the held-out set in one atomic write, dropping malformed entries. */
export async function writeHeldOutPrompts(
  globalDir: string,
  prompts: readonly HeldOutPrompt[],
  workspace?: string
): Promise<HeldOutPrompt[]> {
  const clean = toPrompts(prompts);
  await writeFileAtomic(heldOutFilePath(globalDir, workspace), `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}
