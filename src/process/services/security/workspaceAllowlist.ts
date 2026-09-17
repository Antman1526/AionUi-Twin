/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

/** Minimal shape needed to read a conversation's workspace directory. */
export type WorkspaceBearingConversation = { extra?: { workspace?: string } };

/** Workspace directories of the given conversations, resolved and de-duplicated. */
export function collectKnownWorkspaces(conversations: readonly WorkspaceBearingConversation[]): string[] {
  const seen = new Set<string>();
  for (const conversation of conversations) {
    const workspace = conversation.extra?.workspace;
    if (typeof workspace === 'string' && workspace.trim().length > 0) {
      seen.add(path.resolve(workspace.trim()));
    }
  }
  return [...seen];
}

/**
 * True when `workspacePath` is the workspace of an existing conversation.
 *
 * Semantic indexing walks and reads every file under the given directory, so an
 * untrusted IPC payload must not be able to name an arbitrary path. Comparison
 * is on `path.resolve`d values, which normalises `..` segments and trailing
 * separators without touching the filesystem.
 */
export function isKnownWorkspace(
  workspacePath: string,
  conversations: readonly WorkspaceBearingConversation[]
): boolean {
  const trimmed = workspacePath.trim();
  if (!trimmed) return false;
  const resolved = path.resolve(trimmed);
  return collectKnownWorkspaces(conversations).includes(resolved);
}
