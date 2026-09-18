/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** What kind of text artifact a sleep review may edit. */
export type SleepReviewTargetKind = 'skill' | 'memory';

/** Lifecycle of a staged proposal. */
export type SleepReviewStatus = 'staged' | 'accepted' | 'rejected' | 'rolledBack' | 'failed';

/** The three bounded edit shapes a review may propose. */
export type SleepReviewEditType = 'add' | 'delete' | 'replace';

/**
 * A single bounded edit.
 *
 * - `add` inserts {@link SleepReviewEdit.after} after the first line containing
 *   {@link SleepReviewEdit.anchor}.
 * - `delete` removes the first occurrence of {@link SleepReviewEdit.before}.
 * - `replace` swaps the first occurrence of `before` for `after`.
 */
export type SleepReviewEdit = {
  type: SleepReviewEditType;
  anchor: string;
  before?: string;
  after?: string;
};

/** One staged, reviewable candidate change plus the evidence behind it. */
export type SleepReviewProposal = {
  id: string;
  createdAt: number;
  targetPath: string;
  targetKind: SleepReviewTargetKind;
  /** SHA-256 of the target file as it was when the proposal was drafted. */
  baselineSha256: string;
  status: SleepReviewStatus;
  rationale: string;
  edit: SleepReviewEdit;
  heldOutChecks: string[];
  risk: string;
  rollback: string;
  modelId: string;
  providerId: string;
  sourceConversationIds: string[];
  appliedAt?: number;
  backupPath?: string;
  error?: string;
};

/** A prompt kept out of the drafting context, replayed before and after an edit. */
export type HeldOutPrompt = {
  id: string;
  prompt: string;
  expected?: string;
};

/** A file the sleep review is allowed to read and edit. */
export type SleepReviewTarget = {
  /** Absolute, resolved path. */
  path: string;
  kind: SleepReviewTargetKind;
  /** Short display name, e.g. `my-skill/SKILL.md` or `AGENTS.md`. */
  label: string;
};

/** A conversation offered as review material. */
export type SleepReviewConversation = {
  id: string;
  title: string;
  updatedAt: number;
  /** Workspace the conversation runs in, when it has one. */
  workspace?: string;
};

/** Redacted transcript text plus how many secrets were removed from it. */
export type SleepReviewTranscriptPreview = {
  conversationId: string;
  title: string;
  text: string;
  redactionCount: number;
};

/** Unified diff of a staged proposal, with the two sides it was built from. */
export type SleepReviewDiff = {
  proposalId: string;
  targetPath: string;
  before: string;
  after: string;
  patch: string;
};

/** One held-out prompt replayed against the pre-edit and post-edit target. */
export type HeldOutComparison = {
  promptId: string;
  prompt: string;
  expected?: string;
  beforeOutput: string;
  afterOutput: string;
  error?: string;
};

/** Request accepted by the sleep review `run` bridge method. */
export type SleepReviewRunRequest = {
  conversationIds: string[];
  targetPath: string;
  workspace?: string;
  provider: import('@/common/config/storage').TProviderWithModel;
  /** Refuse any provider that is not a loopback / app-managed local endpoint. */
  localOnly: boolean;
};
