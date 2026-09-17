/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Kind of artifact a Sleep Review proposal targets. */
export type SleepReviewTargetKind = 'skill' | 'memory';

/** Lifecycle of a staged proposal. */
export type SleepReviewProposalStatus = 'staged' | 'accepted' | 'rejected' | 'rolledBack' | 'failed';

/** A single bounded add/delete/replace edit, as described by the skillopt-sleep workflow. */
export type SleepReviewEdit = {
  type: 'add' | 'delete' | 'replace';
  /** Line fragment used to locate the insertion point for `add`. */
  anchor: string;
  /** Exact text to remove (`delete`) or to swap out (`replace`). */
  before?: string;
  /** Text to insert (`add`) or to swap in (`replace`). */
  after?: string;
};

/** A staged, reviewable edit produced by one sleep-review run. */
export type SleepReviewProposal = {
  id: string;
  createdAt: number;
  targetPath: string;
  targetKind: SleepReviewTargetKind;
  /** SHA-256 of the target file at the time the proposal was staged. */
  baselineSha256: string;
  status: SleepReviewProposalStatus;
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

/** One held-out validation prompt, stored per workspace or globally. */
export type HeldOutPrompt = {
  id: string;
  prompt: string;
  expected?: string;
};

/** A conversation that can be harvested as review input. */
export type SleepReviewConversation = {
  id: string;
  name: string;
  modifyTime: number;
  workspace?: string;
};

/** Redacted transcript preview for one conversation. */
export type SleepReviewTranscriptPreview = {
  conversationId: string;
  text: string;
  redactionCount: number;
};

/** A skill or memory file that a proposal can target. */
export type SleepReviewTarget = {
  path: string;
  kind: SleepReviewTargetKind;
  /** Display label (skill name or memory file name). */
  label: string;
};

/** Provider entry offered in the review form, already filtered by `localOnly`. */
export type SleepReviewProvider = {
  id: string;
  name: string;
  platform: string;
  models: string[];
  isLocal: boolean;
};

/** Parameters for one sleep-review run. */
export type SleepReviewRunRequest = {
  conversationIds: string[];
  targetPath: string;
  providerId: string;
  modelId: string;
  localOnly?: boolean;
};

/** Before/after target content for rendering a unified diff in the renderer. */
export type SleepReviewProposalPreview = {
  before: string;
  after: string;
};

/** Side-by-side output of one held-out prompt run against the pre- and post-edit target. */
export type HeldOutRunResult = {
  prompt: string;
  beforeOutput: string;
  afterOutput: string;
};
