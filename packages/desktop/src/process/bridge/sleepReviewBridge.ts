/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { HeldOutPrompt, SleepReviewConversation, SleepReviewTranscriptPreview } from '@/common/types/sleepReview';
import { ClientFactory } from '@/common/api';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import { assertLocalOnlyProvider } from '@process/services/sleepReview/localOnly';
import { readHeldOutPrompts, writeHeldOutPrompts } from '@process/services/sleepReview/heldOutStore';
import { readProposals } from '@process/services/sleepReview/proposalStore';
import { redactTranscript } from '@process/services/sleepReview/redaction';
import {
  acceptProposal,
  previewProposal,
  rejectProposal,
  rollbackProposal,
  runHeldOut,
  runSleepReview,
  type SleepReviewDeps,
} from '@process/services/sleepReview/sleepReviewService';
import { isKnownWorkspace, listTargets } from '@process/services/sleepReview/targetGuard';
import { getSkillsDir } from '@process/utils/initStorage';

const CONVERSATION_PAGE_LIMIT = 500;
const MESSAGE_PAGE_LIMIT = 200;
const MAX_CONVERSATIONS_PER_RUN = 10;
const SLEEP_REVIEW_TIMEOUT_MS = 180_000;

/** The subset of every rotating client the sleep review actually calls. */
type SleepReviewChatCallable = {
  createChatCompletion: (
    params: { model: string; messages: Array<{ role: string; content: string }> },
    options?: { timeout?: number }
  ) => Promise<UnifiedChatCompletionResponse>;
};

function failure(error: unknown): { success: false; msg: string } {
  return { success: false, msg: error instanceof Error ? error.message : String(error) };
}

/** `{userData}/sleep-review` — proposals, backups and the global held-out set. */
function rootDir(): string {
  return path.join(app.getPath('userData'), 'sleep-review');
}

async function listConversationRows(): Promise<TChatConversation[]> {
  const page = await ipcBridge.database.getUserConversations.invoke({ limit: CONVERSATION_PAGE_LIMIT });
  return Array.isArray(page?.items) ? page.items : [];
}

/**
 * Authorize a workspace that arrived over IPC. An unknown directory is dropped
 * rather than rejected, so a stale workspace simply narrows the review to
 * skill targets instead of failing the whole call.
 */
async function authorizeWorkspace(workspace?: string): Promise<string | undefined> {
  if (!workspace) return undefined;
  const conversations = await listConversationRows();
  if (!isKnownWorkspace(workspace, conversations)) {
    throw new Error('Refusing to use a directory that is not a known conversation workspace');
  }
  return path.resolve(workspace);
}

/** Plain text of a message, or '' for non-text message types. */
function messageText(message: TMessage): string {
  if (message.type !== 'text') return '';
  const content = message.content?.content;
  return typeof content === 'string' ? content : '';
}

/** Walk one conversation's history oldest-first, following the cursor. */
async function listConversationMessages(conversationId: string): Promise<TMessage[]> {
  const pages: TMessage[][] = [];
  let before: string | undefined;
  let hasMoreBefore = true;

  while (hasMoreBefore) {
    const page = await ipcBridge.database.getConversationMessages.invoke({
      conversation_id: conversationId,
      limit: MESSAGE_PAGE_LIMIT,
      content_mode: 'full',
      ...(before ? { before } : {}),
    });
    pages.unshift(page.items ?? []);
    before = page.oldest_cursor ?? undefined;
    hasMoreBefore = Boolean(page.has_more_before && before);
  }

  return pages.flat();
}

/**
 * Redacted transcript of one conversation.
 *
 * This is the only path by which conversation text leaves the process layer,
 * and it always goes through {@link redactTranscript} first.
 */
async function buildTranscript(conversationId: string, title: string): Promise<SleepReviewTranscriptPreview> {
  const messages = await listConversationMessages(conversationId);
  const { text, redactionCount } = redactTranscript(
    messages.map((message) => ({
      role: message.position === 'right' ? 'user' : 'assistant',
      text: messageText(message),
    }))
  );
  return { conversationId, title, text, redactionCount };
}

/** Real completion call. Mirrors the arena client — the same rotating client, no streaming. */
function makeCompletion(provider: TProviderWithModel): SleepReviewDeps['complete'] {
  return async ({ prompt }) => {
    const rotatingClient = await ClientFactory.createRotatingClient(provider, {
      timeout: SLEEP_REVIEW_TIMEOUT_MS,
      rotatingOptions: { maxRetries: 1, retryDelay: 500 },
    });
    // `ClientFactory` returns a union of three clients whose parameter types only
    // overlap structurally; every branch reads the same `{ model, messages }` shape.
    const client = rotatingClient as unknown as SleepReviewChatCallable;
    const completion = await client.createChatCompletion(
      { model: provider.use_model, messages: [{ role: 'user', content: prompt }] },
      { timeout: SLEEP_REVIEW_TIMEOUT_MS }
    );
    return completion.choices?.[0]?.message?.content ?? '';
  };
}

/** Deps for a call that does not talk to a model. */
function readOnlyDeps(workspace?: string): SleepReviewDeps {
  return {
    rootDir: rootDir(),
    skillsDir: getSkillsDir(),
    ...(workspace ? { workspace } : {}),
    complete: () => Promise.reject(new Error('This action does not call a model')),
  };
}

/** Re-derive the workspace a stored proposal belongs to, so its guard can run. */
async function workspaceForProposal(proposalId: string): Promise<string | undefined> {
  const proposal = (await readProposals(rootDir())).find((entry) => entry.id === proposalId);
  if (!proposal || proposal.targetKind !== 'memory') return undefined;

  const conversations = await listConversationRows();
  const targetDirectory = path.dirname(path.resolve(proposal.targetPath));
  for (const conversation of conversations) {
    const workspace = conversation?.extra?.workspace;
    if (typeof workspace !== 'string' || !workspace) continue;
    const resolved = path.resolve(workspace);
    // Memory targets live at the workspace root or one level down (`.aionui/`).
    if (targetDirectory === resolved || path.dirname(targetDirectory) === resolved) return resolved;
  }
  return undefined;
}

/** Bridge for the native SkillOpt sleep review. */
export function initSleepReviewBridge(): void {
  ipcBridge.sleepReview.listConversations.provider(async () => {
    try {
      const data: SleepReviewConversation[] = (await listConversationRows()).map((conversation) => ({
        id: conversation.id,
        title: conversation.name ?? '',
        updatedAt: conversation.modified_at ?? conversation.created_at ?? 0,
        ...(typeof conversation?.extra?.workspace === 'string' && conversation.extra.workspace
          ? { workspace: conversation.extra.workspace }
          : {}),
      }));
      return { success: true, data };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.previewTranscript.provider(async ({ conversationId }) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId) throw new Error('Missing conversation id');
      const conversation = (await listConversationRows()).find((entry) => entry.id === conversationId);
      if (!conversation) throw new Error('Unknown conversation');
      return { success: true, data: await buildTranscript(conversationId, conversation.name ?? '') };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.listTargets.provider(async ({ workspace }) => {
    try {
      const authorized = await authorizeWorkspace(workspace);
      const data = await listTargets({
        skillsDir: getSkillsDir(),
        ...(authorized ? { workspace: authorized } : {}),
      });
      return { success: true, data };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.run.provider(async ({ conversationIds, targetPath, workspace, provider, localOnly }) => {
    try {
      if (!provider?.use_model) throw new Error('Pick a model for the review');
      if (localOnly) assertLocalOnlyProvider(provider);
      if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
        throw new Error('Pick at least one conversation to review');
      }
      if (conversationIds.length > MAX_CONVERSATIONS_PER_RUN) {
        throw new Error(`Pick at most ${MAX_CONVERSATIONS_PER_RUN} conversations`);
      }

      const authorized = await authorizeWorkspace(workspace);
      const conversations = await listConversationRows();
      const transcripts = await Promise.all(
        conversationIds.map((id) => {
          const conversation = conversations.find((entry) => entry.id === id);
          if (!conversation) throw new Error('Unknown conversation');
          return buildTranscript(id, conversation.name ?? '');
        })
      );

      const proposal = await runSleepReview(
        {
          targetPath,
          transcripts,
          providerId: provider.id,
          modelId: provider.use_model,
        },
        {
          rootDir: rootDir(),
          skillsDir: getSkillsDir(),
          ...(authorized ? { workspace: authorized } : {}),
          complete: makeCompletion(provider),
        }
      );
      return { success: true, data: proposal };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.listProposals.provider(async () => {
    try {
      return { success: true, data: await readProposals(rootDir()) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.previewProposal.provider(async ({ proposalId }) => {
    try {
      const workspace = await workspaceForProposal(proposalId);
      return { success: true, data: await previewProposal(proposalId, readOnlyDeps(workspace)) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.accept.provider(async ({ proposalId }) => {
    try {
      const workspace = await workspaceForProposal(proposalId);
      return { success: true, data: await acceptProposal(proposalId, readOnlyDeps(workspace)) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.reject.provider(async ({ proposalId }) => {
    try {
      return { success: true, data: await rejectProposal(proposalId, readOnlyDeps()) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.rollback.provider(async ({ proposalId }) => {
    try {
      const workspace = await workspaceForProposal(proposalId);
      return { success: true, data: await rollbackProposal(proposalId, readOnlyDeps(workspace)) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.runHeldOut.provider(async ({ proposalId, provider, localOnly }) => {
    try {
      if (!provider?.use_model) throw new Error('Pick a model for the replay');
      if (localOnly) assertLocalOnlyProvider(provider);
      const workspace = await workspaceForProposal(proposalId);
      const data = await runHeldOut(proposalId, {
        rootDir: rootDir(),
        skillsDir: getSkillsDir(),
        ...(workspace ? { workspace } : {}),
        complete: makeCompletion(provider),
      });
      return { success: true, data };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.listHeldOut.provider(async ({ workspace }) => {
    try {
      const authorized = await authorizeWorkspace(workspace);
      return { success: true, data: await readHeldOutPrompts(rootDir(), authorized) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcBridge.sleepReview.saveHeldOut.provider(async ({ workspace, prompts }) => {
    try {
      const authorized = await authorizeWorkspace(workspace);
      const data: HeldOutPrompt[] = await writeHeldOutPrompts(rootDir(), prompts ?? [], authorized);
      return { success: true, data };
    } catch (error) {
      return failure(error);
    }
  });
}
