/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ClientFactory } from '@/common/api/ClientFactory';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  HeldOutPrompt,
  HeldOutRunResult,
  SleepReviewProposal,
  SleepReviewRunRequest,
  SleepReviewTarget,
} from '@/common/types/sleepReview';
import { sha256 } from './applyEdit';
import { buildReviewPrompt, parseReviewAnswer, type PromptTranscript } from './prompt';
import { isLocalProviderForReview } from './providers';
import type { SleepReviewStore } from './store';
import { resolveAllowedTarget } from './targetGuard';

const SYSTEM_PROMPT =
  'You are running the AionUi skillopt-sleep review loop. Propose one small, validated, reversible edit to an instruction file. Answer with a single JSON object and nothing else.';

/** Everything `runReview` needs, injected so the module stays testable. */
export type RunReviewDeps = {
  store: SleepReviewStore;
  /** All configured providers (`model.config`). */
  providers: IProvider[];
  /** Redacted transcripts for the selected conversations. */
  transcripts: PromptTranscript[];
  /** Held-out prompt library resolved for the relevant workspace. */
  heldOutPrompts: HeldOutPrompt[];
  /** Validated workspace of the source conversations, when they have one. */
  workspace?: string;
};

/**
 * Minimal structural view of the rotating clients. Each concrete client types
 * `createChatCompletion` against its own SDK, so the union cannot be called
 * directly; every implementation accepts this OpenAI-shaped payload.
 */
type ReviewChatClient = {
  createChatCompletion(params: {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
  }): Promise<UnifiedChatCompletionResponse>;
};

/** Send one chat completion through the app's existing rotating client stack. */
async function complete(provider: TProviderWithModel, system: string, user: string): Promise<string> {
  const client = (await ClientFactory.createRotatingClient(provider)) as unknown as ReviewChatClient;
  const completion = await client.createChatCompletion({
    model: provider.useModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

/**
 * Resolve the provider to review with, refusing non-local providers when the
 * caller asked for local-only mode.
 */
export function resolveProvider(
  providers: IProvider[],
  providerId: string,
  modelId: string,
  localOnly?: boolean
): { provider?: TProviderWithModel; error?: string } {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return { error: `Provider not found: ${providerId}` };
  if (localOnly && !isLocalProviderForReview(provider)) {
    return { error: `Provider "${provider.name}" is not local. Turn off local-only mode to use it.` };
  }
  const { model: _model, ...rest } = provider;
  return { provider: { ...rest, useModel: modelId } };
}

/**
 * Run one sleep-review cycle and persist the result as a `staged` proposal.
 *
 * Transcripts handed in through `deps` must already be redacted; this function
 * never reads raw conversation text itself.
 *
 * @returns `{ proposal }` on success, or `{ error }` with the reason it failed.
 */
export async function runReview(
  request: SleepReviewRunRequest,
  deps: RunReviewDeps
): Promise<{ proposal?: SleepReviewProposal; error?: string }> {
  // The target is validated before anything else: an unlisted path must never
  // be read, let alone embedded in a prompt sent to a caller-chosen provider.
  let target: SleepReviewTarget;
  try {
    target = await resolveAllowedTarget(request.targetPath, deps.workspace);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const { provider, error: providerError } = resolveProvider(
    deps.providers,
    request.providerId,
    request.modelId,
    request.localOnly
  );
  if (!provider) return { error: providerError };

  let targetContent: string;
  try {
    targetContent = await fs.readFile(target.path, 'utf8');
  } catch (error) {
    return { error: `Target file could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }

  const prompt = buildReviewPrompt({
    targetPath: target.path,
    targetContent,
    transcripts: deps.transcripts,
    heldOutPrompts: deps.heldOutPrompts,
  });

  let reply: string;
  try {
    reply = await complete(provider, SYSTEM_PROMPT, prompt);
  } catch (error) {
    return { error: `Model call failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const { answer, error: parseError } = parseReviewAnswer(reply);
  if (!answer) return { error: parseError };

  const proposal: SleepReviewProposal = {
    id: randomUUID(),
    createdAt: Date.now(),
    targetPath: target.path,
    targetKind: target.kind,
    baselineSha256: sha256(targetContent),
    status: 'staged',
    rationale: answer.rationale,
    edit: answer.edit,
    heldOutChecks: answer.heldOutChecks,
    risk: answer.risk,
    rollback: answer.rollback,
    modelId: request.modelId,
    providerId: request.providerId,
    sourceConversationIds: request.conversationIds,
  };

  await deps.store.addProposal(proposal);
  return { proposal };
}

/**
 * Run each of a proposal's held-out checks twice — once with the current target
 * content as system context, once with the edit applied — and return both
 * outputs verbatim. No automatic scoring: a human compares the two columns.
 */
export async function runHeldOutChecks(params: {
  proposal: SleepReviewProposal;
  providers: IProvider[];
  before: string;
  after: string;
}): Promise<{ results?: HeldOutRunResult[]; error?: string }> {
  const { provider, error: providerError } = resolveProvider(
    params.providers,
    params.proposal.providerId,
    params.proposal.modelId
  );
  if (!provider) return { error: providerError };

  const results: HeldOutRunResult[] = [];
  for (const prompt of params.proposal.heldOutChecks) {
    try {
      const [beforeOutput, afterOutput] = await Promise.all([
        complete(provider, params.before, prompt),
        complete(provider, params.after, prompt),
      ]);
      results.push({ prompt, beforeOutput, afterOutput });
    } catch (error) {
      return { error: `Held-out run failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { results };
}
