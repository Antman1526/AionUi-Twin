/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

/** Minimal conversation shape needed to authorize a workspace path. */
export type WorkspaceBearingConversation = {
  extra?: { workspace?: string } | null;
};

/** `conversation_id` value used for rows that belong to a workspace, not a chat. */
export function workspaceConversationId(workspacePath: string): string {
  return `workspace:${path.resolve(workspacePath)}`;
}

/** True when `conversationId` was produced by {@link workspaceConversationId}. */
export function isWorkspaceConversationId(conversationId: string): boolean {
  return conversationId.startsWith('workspace:');
}

/**
 * Authorize a workspace path that arrived over IPC.
 *
 * The WebUI can reach the IPC surface, so an arbitrary directory must never be
 * walked and read. Only a path that resolves exactly to the workspace of an
 * existing conversation is accepted; `..` segments, relative paths and
 * trailing-slash variants of unknown directories all normalize away before the
 * comparison and are therefore rejected.
 */
export function isKnownWorkspace(candidate: string, conversations: readonly WorkspaceBearingConversation[]): boolean {
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
