/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SleepReviewTarget } from '@/common/types/sleepReview';

/** Memory files a workspace may expose to a sleep review, in display order. */
export const WORKSPACE_MEMORY_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md', '.aionui/memory.md'] as const;

/** Directory name that holds app-shipped skills. Never editable by a review. */
const BUILTIN_SKILL_DIR = '_builtin';

/** How deep under the user skills root a `SKILL.md` is still discovered. */
const MAX_SKILL_DEPTH = 3;

/** Minimal conversation shape needed to authorize a workspace path. */
export type WorkspaceBearingConversation = {
  extra?: { workspace?: string } | null;
};

/**
 * Authorize a workspace path that arrived over IPC.
 *
 * The WebUI can reach the IPC surface, so an arbitrary directory must never be
 * walked or read. Only a path that resolves exactly to the workspace of an
 * existing conversation is accepted; relative paths, `..` segments and
 * trailing-slash variants all normalize away before the comparison.
 */
export function isKnownWorkspace(candidate: unknown, conversations: readonly WorkspaceBearingConversation[]): boolean {
  if (typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return false;

  const resolved = path.resolve(trimmed);
  return conversations.some((conversation) => {
    const workspace = conversation?.extra?.workspace;
    if (typeof workspace !== 'string' || !workspace.trim() || !path.isAbsolute(workspace)) return false;
    return path.resolve(workspace) === resolved;
  });
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Recursively collect `SKILL.md` files under `root`, skipping `_builtin`. */
async function collectSkillFiles(root: string, directory: string, depth: number): Promise<SleepReviewTarget[]> {
  if (depth > MAX_SKILL_DEPTH) return [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const targets: SleepReviewTarget[] = [];
  for (const entry of entries) {
    // Symlinks could point anywhere; a skill target must live under the root.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === BUILTIN_SKILL_DIR) continue;
      targets.push(...(await collectSkillFiles(root, path.join(directory, entry.name), depth + 1)));
      continue;
    }
    if (!entry.isFile() || entry.name.toLowerCase() !== 'skill.md') continue;
    const absolutePath = path.join(directory, entry.name);
    targets.push({
      path: absolutePath,
      kind: 'skill',
      label: path.relative(root, absolutePath).split(path.sep).join('/'),
    });
  }
  return targets;
}

export type ListTargetsOptions = {
  /** Root of the user's own skills, e.g. `{config}/skills`. */
  skillsDir: string;
  /** Already-authorized workspace, or undefined to list skill targets only. */
  workspace?: string;
};

/**
 * Every file a sleep review may read and edit: the user's own skill files plus
 * the memory files of one authorized workspace. Built-in skills are excluded —
 * they are app-owned and would be overwritten by the next update anyway.
 *
 * Callers must authorize `workspace` with {@link isKnownWorkspace} first.
 */
export async function listTargets({ skillsDir, workspace }: ListTargetsOptions): Promise<SleepReviewTarget[]> {
  const root = path.resolve(skillsDir);
  const targets = await collectSkillFiles(root, root, 1);

  if (workspace) {
    const workspaceRoot = path.resolve(workspace);
    for (const relative of WORKSPACE_MEMORY_FILES) {
      const absolutePath = path.join(workspaceRoot, relative);
      if (await isFile(absolutePath)) {
        targets.push({ path: absolutePath, kind: 'memory', label: relative });
      }
    }
  }

  return targets.toSorted((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export type ResolveTargetDeps = ListTargetsOptions & {
  /** Injection point so the allow-list can be faked in tests. */
  list?: (options: ListTargetsOptions) => Promise<SleepReviewTarget[]>;
};

/**
 * Resolve `targetPath` against the allow-list and return the matching target.
 *
 * Matching is exact resolved-path equality against {@link listTargets}, so an
 * unlisted path throws before the file is opened — nothing is read and nothing
 * is written. Called on every entry point that touches a target file,
 * including `accept` and `rollback`, where the *stored* path is re-validated
 * rather than trusted.
 */
export async function resolveAllowedTarget(
  targetPath: unknown,
  { skillsDir, workspace, list = listTargets }: ResolveTargetDeps
): Promise<SleepReviewTarget> {
  if (typeof targetPath !== 'string' || !targetPath.trim() || !path.isAbsolute(targetPath)) {
    throw new Error('Sleep review target must be an absolute path');
  }

  const resolved = path.resolve(targetPath);
  const allowed = await list({ skillsDir, ...(workspace ? { workspace } : {}) });
  const match = allowed.find((target) => path.resolve(target.path) === resolved);
  if (!match) {
    throw new Error('Refusing to touch a file that is not a listed sleep review target');
  }
  return match;
}
