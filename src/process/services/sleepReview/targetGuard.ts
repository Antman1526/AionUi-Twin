/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { SleepReviewTarget } from '@/common/types/sleepReview';
import { listTargets } from './targets';

/** Shape of the conversation fields this module needs. */
type WorkspaceCarrier = { extra?: { workspace?: string } };

/**
 * Resolve a caller-supplied target path against the allow-list produced by
 * {@link listTargets}.
 *
 * Every `sleepReview.*` IPC handler is reachable by any authenticated WebUI
 * user, so a target path is untrusted input. Only a path that resolves to
 * exactly one of the listed skill / memory files may ever be read or written.
 *
 * @param targetPath Untrusted path from an IPC payload or a stored proposal.
 * @param workspace Optional (already validated) workspace whose memory files count as targets.
 * @returns The matching allow-list entry, whose `path` is the canonical one to use.
 * @throws when the path is empty or is not on the allow-list.
 */
export async function resolveAllowedTarget(targetPath: string, workspace?: string): Promise<SleepReviewTarget> {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error('Sleep Review target path is required.');
  }

  const resolved = path.resolve(targetPath);
  const allowed = await listTargets({ workspace });
  const match = allowed.find((target) => path.resolve(target.path) === resolved);
  if (!match) {
    throw new Error(`Not an allowed Sleep Review target: ${targetPath}`);
  }
  return match;
}

/**
 * Whether a caller-supplied workspace path belongs to an existing conversation.
 *
 * Without this check `saveHeldOut` would let any caller create a `.aionui`
 * directory anywhere on disk.
 *
 * @param workspacePath Untrusted workspace path from an IPC payload.
 * @param conversations All known conversations.
 */
export function isKnownWorkspace(workspacePath: string, conversations: readonly WorkspaceCarrier[]): boolean {
  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) return false;
  const resolved = path.resolve(workspacePath);
  return conversations.some((conversation) => {
    const workspace = conversation?.extra?.workspace;
    return typeof workspace === 'string' && workspace.length > 0 && path.resolve(workspace) === resolved;
  });
}
