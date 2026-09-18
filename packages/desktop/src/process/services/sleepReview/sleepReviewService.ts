/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import { createTwoFilesPatch } from 'diff';
import type {
  HeldOutComparison,
  SleepReviewDiff,
  SleepReviewProposal,
  SleepReviewStatus,
  SleepReviewTarget,
} from '@/common/types/sleepReview';
import { applyEdit, sha256 } from './editApply';
import { readHeldOutPrompts } from './heldOutStore';
import { backupTarget, getProposal, upsertProposal } from './proposalStore';
import { buildReviewPrompt, parseProposalDraft } from './reviewPrompt';
import { resolveAllowedTarget, type ListTargetsOptions } from './targetGuard';

/** Single chat call the review needs; the bridge wires it to the rotating client. */
export type SleepReviewCompletion = (params: { prompt: string }) => Promise<string>;

export type SleepReviewDeps = {
  /** `{userData}/sleep-review` — proposals, backups and the global held-out set. */
  rootDir: string;
  skillsDir: string;
  /** Already-authorized workspace, or undefined for a skills-only review. */
  workspace?: string;
  complete: SleepReviewCompletion;
  now?: () => number;
  newId?: () => string;
  /** Injection point so the allow-list can be faked in tests. */
  list?: (options: ListTargetsOptions) => Promise<SleepReviewTarget[]>;
};

export type RunSleepReviewParams = {
  targetPath: string;
  /** Redacted transcripts. Raw text never reaches this function. */
  transcripts: ReadonlyArray<{ conversationId: string; title: string; text: string }>;
  providerId: string;
  modelId: string;
};

function guardOptions(deps: SleepReviewDeps) {
  return {
    skillsDir: deps.skillsDir,
    ...(deps.workspace ? { workspace: deps.workspace } : {}),
    ...(deps.list ? { list: deps.list } : {}),
  };
}

/** Resolve the target through the allow-list, then read it. Never the other way round. */
async function readAllowedTarget(targetPath: string, deps: SleepReviewDeps): Promise<[SleepReviewTarget, string]> {
  const target = await resolveAllowedTarget(targetPath, guardOptions(deps));
  return [target, await fs.readFile(target.path, 'utf8')];
}

async function requireProposal(proposalId: string, deps: SleepReviewDeps): Promise<SleepReviewProposal> {
  const proposal = await getProposal(deps.rootDir, proposalId);
  if (!proposal) throw new Error('Unknown sleep review proposal');
  return proposal;
}

/**
 * Draft one proposal and stage it.
 *
 * The target is authorized before it is read, the baseline hash is recorded so
 * `accept` can detect drift, and the result is persisted as `staged` — nothing
 * is written to the target file here.
 */
export async function runSleepReview(
  params: RunSleepReviewParams,
  deps: SleepReviewDeps
): Promise<SleepReviewProposal> {
  const [target, content] = await readAllowedTarget(params.targetPath, deps);
  const heldOutPrompts = await readHeldOutPrompts(deps.rootDir, deps.workspace);

  const prompt = buildReviewPrompt({
    targetLabel: target.label,
    targetKind: target.kind,
    targetContent: content,
    transcripts: params.transcripts.map((entry) => ({ title: entry.title, text: entry.text })),
    heldOutPrompts,
  });

  const draft = parseProposalDraft(await deps.complete({ prompt }));
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `sr-${now()}-${Math.random().toString(36).slice(2, 10)}`);

  return upsertProposal(deps.rootDir, {
    id: newId(),
    createdAt: now(),
    targetPath: target.path,
    targetKind: target.kind,
    baselineSha256: sha256(content),
    status: 'staged',
    rationale: draft.rationale,
    edit: draft.edit,
    heldOutChecks: draft.heldOutChecks,
    risk: draft.risk,
    rollback: draft.rollback,
    modelId: params.modelId,
    providerId: params.providerId,
    sourceConversationIds: params.transcripts.map((entry) => entry.conversationId),
  });
}

/** Unified diff of a staged proposal, with the two sides it was computed from. */
export async function previewProposal(proposalId: string, deps: SleepReviewDeps): Promise<SleepReviewDiff> {
  const proposal = await requireProposal(proposalId, deps);
  // The stored path is re-validated: a proposal file edited on disk must not
  // become a way to read an arbitrary file.
  const [target, before] = await readAllowedTarget(proposal.targetPath, deps);
  const after = applyEdit(before, proposal.edit);
  return {
    proposalId: proposal.id,
    targetPath: target.path,
    before,
    after,
    patch: createTwoFilesPatch(target.label, target.label, before, after, '', '', { context: 3 }),
  };
}

async function setStatus(
  proposal: SleepReviewProposal,
  status: SleepReviewStatus,
  deps: SleepReviewDeps,
  extra: Partial<SleepReviewProposal> = {}
): Promise<SleepReviewProposal> {
  return upsertProposal(deps.rootDir, { ...proposal, status, ...extra });
}

/** Mark a proposal rejected. Nothing is read or written outside the store. */
export async function rejectProposal(proposalId: string, deps: SleepReviewDeps): Promise<SleepReviewProposal> {
  return setStatus(await requireProposal(proposalId, deps), 'rejected', deps);
}

/**
 * Apply a staged proposal to its target file.
 *
 * Refuses when the target drifted since the proposal was drafted — the stored
 * `before` text may no longer mean what the model thought it meant. The
 * pre-edit file is copied to `backups/` before the write so `rollback` is
 * always possible.
 */
export async function acceptProposal(proposalId: string, deps: SleepReviewDeps): Promise<SleepReviewProposal> {
  const proposal = await requireProposal(proposalId, deps);
  if (proposal.status === 'accepted') throw new Error('This proposal has already been accepted');

  const [target, current] = await readAllowedTarget(proposal.targetPath, deps);
  if (sha256(current) !== proposal.baselineSha256) {
    const drifted = await setStatus(proposal, 'failed', deps, {
      error: 'The target file changed after this proposal was staged. Re-run the review.',
    });
    throw new Error(drifted.error);
  }

  let next: string;
  try {
    next = applyEdit(current, proposal.edit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(proposal, 'failed', deps, { error: message });
    throw error;
  }

  const backupPath = await backupTarget(deps.rootDir, proposal.id, target.path);
  await fs.writeFile(target.path, next, 'utf8');
  const now = deps.now ?? Date.now;
  return setStatus(proposal, 'accepted', deps, { appliedAt: now(), backupPath });
}

/** Restore the backup taken when the proposal was accepted. */
export async function rollbackProposal(proposalId: string, deps: SleepReviewDeps): Promise<SleepReviewProposal> {
  const proposal = await requireProposal(proposalId, deps);
  if (!proposal.backupPath) throw new Error('This proposal has no backup to roll back to');

  // Re-validated here too: `accept` may have been followed by an edit to the
  // stored proposal, and rollback writes to the target file.
  const target = await resolveAllowedTarget(proposal.targetPath, guardOptions(deps));
  const backup = await fs.readFile(proposal.backupPath, 'utf8');
  await fs.writeFile(target.path, backup, 'utf8');
  return setStatus(proposal, 'rolledBack', deps);
}

/**
 * Replay every held-out prompt twice — once with the current target content as
 * context, once with the edited content — and return both answers side by side.
 *
 * No scoring: the user decides which column reads better.
 */
export async function runHeldOut(proposalId: string, deps: SleepReviewDeps): Promise<HeldOutComparison[]> {
  const proposal = await requireProposal(proposalId, deps);
  const [target, before] = await readAllowedTarget(proposal.targetPath, deps);
  const after = applyEdit(before, proposal.edit);
  const prompts = await readHeldOutPrompts(deps.rootDir, deps.workspace);

  const results: HeldOutComparison[] = [];
  for (const prompt of prompts) {
    const ask = (content: string): Promise<string> =>
      deps.complete({
        prompt: [
          `The following is the current content of ${target.label}. Follow it exactly.`,
          '',
          '```',
          content,
          '```',
          '',
          `Task: ${prompt.prompt}`,
        ].join('\n'),
      });

    try {
      results.push({
        promptId: prompt.id,
        prompt: prompt.prompt,
        ...(prompt.expected ? { expected: prompt.expected } : {}),
        beforeOutput: await ask(before),
        afterOutput: await ask(after),
      });
    } catch (error) {
      results.push({
        promptId: prompt.id,
        prompt: prompt.prompt,
        ...(prompt.expected ? { expected: prompt.expected } : {}),
        beforeOutput: '',
        afterOutput: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
