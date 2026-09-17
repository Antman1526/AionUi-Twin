/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import type {
  HeldOutPrompt,
  SleepReviewConversation,
  SleepReviewProposal,
  SleepReviewProvider,
} from '@/common/types/sleepReview';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { acceptProposal, previewProposal, rollbackProposal } from '@process/services/sleepReview/applyEdit';
import type { PromptTranscript } from '@process/services/sleepReview/prompt';
import { isLocalProviderForReview } from '@process/services/sleepReview/providers';
import { isKnownWorkspace } from '@process/services/sleepReview/targetGuard';
import { listTargets } from '@process/services/sleepReview/targets';
import { runHeldOutChecks, runReview } from '@process/services/sleepReview/runReview';
import { getSleepReviewStore } from '@process/services/sleepReview/store';
import { buildRedactedTranscript } from '@process/services/sleepReview/transcripts';
import { ProcessConfig } from '@process/utils/initStorage';

const MESSAGE_PAGE_SIZE = 500;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getProviders(): Promise<IProvider[]> {
  const stored = await ProcessConfig.get('model.config');
  return Array.isArray(stored) ? stored : [];
}

/** Workspace of a conversation, when its type carries one. */
function conversationWorkspace(conversation: { extra?: { workspace?: string } }): string | undefined {
  return typeof conversation.extra?.workspace === 'string' ? conversation.extra.workspace : undefined;
}

/**
 * Register every `sleepReview.*` IPC handler.
 *
 * @param repo Conversation repository used to harvest review input.
 */
export function initSleepReviewBridge(repo: IConversationRepository): void {
  const store = getSleepReviewStore();

  /**
   * Validate a caller-supplied workspace against the known conversations.
   * An unknown workspace is rejected rather than silently ignored.
   */
  const requireKnownWorkspace = async (workspace?: string): Promise<string | undefined> => {
    if (!workspace) return undefined;
    if (!isKnownWorkspace(workspace, await repo.listAllConversations())) {
      throw new Error(`Not a known workspace: ${workspace}`);
    }
    return workspace;
  };

  /** Workspace of the first source conversation of a stored proposal, if any. */
  const proposalWorkspace = async (proposal: SleepReviewProposal): Promise<string | undefined> => {
    for (const conversationId of proposal.sourceConversationIds) {
      const conversation = await repo.getConversation(conversationId);
      const workspace = conversation ? conversationWorkspace(conversation) : undefined;
      if (workspace) return workspace;
    }
    return undefined;
  };

  /** Redacted transcript for one conversation, or undefined when unknown. */
  const loadTranscript = async (conversationId: string): Promise<PromptTranscript | undefined> => {
    const conversation = await repo.getConversation(conversationId);
    if (!conversation) return undefined;
    const messages = await repo.getMessages(conversationId, 0, MESSAGE_PAGE_SIZE, 'ASC');
    const { text } = buildRedactedTranscript(messages.data);
    return { conversationId, name: conversation.name, redactedText: text };
  };

  const requireProposal = async (id: string): Promise<SleepReviewProposal> => {
    const proposal = await store.getProposal(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    return proposal;
  };

  ipcBridge.sleepReview.listConversations.provider(async () => {
    try {
      const conversations = await repo.listAllConversations();
      const data: SleepReviewConversation[] = conversations.map((conversation) => ({
        id: conversation.id,
        name: conversation.name,
        modifyTime: conversation.modifyTime ?? conversation.createTime ?? 0,
        workspace: conversationWorkspace(conversation),
      }));
      data.sort((a, b) => b.modifyTime - a.modifyTime);
      return { success: true, data };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.previewTranscript.provider(async ({ conversationId }) => {
    try {
      const messages = await repo.getMessages(conversationId, 0, MESSAGE_PAGE_SIZE, 'ASC');
      const { text, redactionCount } = buildRedactedTranscript(messages.data);
      return { success: true, data: { conversationId, text, redactionCount } };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.listTargets.provider(async ({ workspace } = {}) => {
    try {
      return { success: true, data: await listTargets({ workspace: await requireKnownWorkspace(workspace) }) };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.listProviders.provider(async ({ localOnly } = {}) => {
    try {
      const data: SleepReviewProvider[] = (await getProviders())
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          platform: provider.platform,
          models: Array.isArray(provider.model) ? provider.model : [],
          isLocal: isLocalProviderForReview(provider),
        }))
        .filter((provider) => (localOnly ? provider.isLocal : true));
      return { success: true, data };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.run.provider(async (request) => {
    try {
      const transcripts: PromptTranscript[] = [];
      let workspace: string | undefined;
      for (const conversationId of request.conversationIds) {
        const transcript = await loadTranscript(conversationId);
        if (!transcript) continue;
        transcripts.push(transcript);
        if (!workspace) {
          const conversation = await repo.getConversation(conversationId);
          workspace = conversation ? conversationWorkspace(conversation) : undefined;
        }
      }

      const { proposal, error } = await runReview(request, {
        store,
        providers: await getProviders(),
        transcripts,
        heldOutPrompts: await store.listHeldOutPrompts(workspace),
        workspace,
      });
      return proposal ? { success: true, data: proposal } : { success: false, msg: error };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.listProposals.provider(async () => {
    try {
      return { success: true, data: await store.listProposals() };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.previewProposal.provider(async ({ id }) => {
    try {
      const proposal = await requireProposal(id);
      return { success: true, data: await previewProposal(proposal, { workspace: await proposalWorkspace(proposal) }) };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.accept.provider(async ({ id }) => {
    try {
      const proposal = await requireProposal(id);
      const updated = await acceptProposal(store, proposal, { workspace: await proposalWorkspace(proposal) });
      return updated.status === 'failed'
        ? { success: false, msg: updated.error ?? 'Proposal could not be applied.', data: updated }
        : { success: true, data: updated };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.reject.provider(async ({ id }) => {
    try {
      await requireProposal(id);
      const updated = await store.updateProposal(id, { status: 'rejected' });
      return updated ? { success: true, data: updated } : { success: false, msg: `Proposal not found: ${id}` };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.rollback.provider(async ({ id }) => {
    try {
      const proposal = await requireProposal(id);
      const updated = await rollbackProposal(store, proposal, { workspace: await proposalWorkspace(proposal) });
      return updated.status === 'failed'
        ? { success: false, msg: updated.error ?? 'Rollback failed.', data: updated }
        : { success: true, data: updated };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.listHeldOut.provider(async ({ workspace } = {}) => {
    try {
      return { success: true, data: await store.listHeldOutPrompts(await requireKnownWorkspace(workspace)) };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.saveHeldOut.provider(async ({ workspace, prompts }) => {
    try {
      const sanitized: HeldOutPrompt[] = (Array.isArray(prompts) ? prompts : [])
        .filter((item) => typeof item?.prompt === 'string' && item.prompt.trim().length > 0)
        .map((item) => ({ id: item.id, prompt: item.prompt.trim(), expected: item.expected?.trim() || undefined }));
      const validated = await requireKnownWorkspace(workspace);
      return { success: true, data: await store.saveHeldOutPrompts(sanitized, validated) };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });

  ipcBridge.sleepReview.runHeldOut.provider(async ({ proposalId }) => {
    try {
      const proposal = await requireProposal(proposalId);
      const { before, after } = await previewProposal(proposal, { workspace: await proposalWorkspace(proposal) });
      const { results, error } = await runHeldOutChecks({ proposal, providers: await getProviders(), before, after });
      return results ? { success: true, data: results } : { success: false, msg: error };
    } catch (error) {
      return { success: false, msg: toMessage(error) };
    }
  });
}
