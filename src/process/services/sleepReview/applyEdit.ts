/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SleepReviewEdit, SleepReviewProposal, SleepReviewTarget } from '@/common/types/sleepReview';
import type { SleepReviewStore } from './store';
import { resolveAllowedTarget } from './targetGuard';

/**
 * Result of applying an edit to an in-memory copy of the target file.
 * Exactly one of `content` / `error` is set.
 */
export type ApplyEditResult = { content?: string; error?: string };

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Apply one bounded edit to file content, in memory.
 *
 * - `add` inserts `after` on the line following the first line containing `anchor`.
 * - `delete` removes the first occurrence of `before`.
 * - `replace` swaps the first occurrence of `before` for `after`.
 *
 * Pure function — the caller decides whether to write the result to disk.
 *
 * @param content Current file content.
 * @param edit The proposed edit.
 * @returns The new content, or a human-readable reason the edit does not apply.
 */
export function applyEdit(content: string, edit: SleepReviewEdit): ApplyEditResult {
  switch (edit.type) {
    case 'add': {
      const insertion = edit.after ?? '';
      if (!insertion) return { error: 'Edit of type "add" has no text to insert.' };
      if (!edit.anchor) return { error: 'Edit of type "add" has no anchor.' };
      const lines = content.split('\n');
      const index = lines.findIndex((line) => line.includes(edit.anchor));
      if (index < 0) return { error: `Anchor not found in target file: ${edit.anchor}` };
      lines.splice(index + 1, 0, insertion);
      return { content: lines.join('\n') };
    }
    case 'delete': {
      const target = edit.before ?? '';
      if (!target) return { error: 'Edit of type "delete" has no text to remove.' };
      const at = content.indexOf(target);
      if (at < 0) return { error: 'Text to delete was not found in the target file.' };
      return { content: content.slice(0, at) + content.slice(at + target.length) };
    }
    case 'replace': {
      const target = edit.before ?? '';
      if (!target) return { error: 'Edit of type "replace" has no text to replace.' };
      const at = content.indexOf(target);
      if (at < 0) return { error: 'Text to replace was not found in the target file.' };
      return { content: content.slice(0, at) + (edit.after ?? '') + content.slice(at + target.length) };
    }
    default:
      return { error: `Unsupported edit type: ${String((edit as SleepReviewEdit).type)}` };
  }
}

/** Human-readable message for an unknown error value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compute the before/after content of a proposal against the file as it is now.
 *
 * The stored target path is re-validated against the allow-list first: a
 * proposal record is persisted JSON and must not be trusted to still point at a
 * reviewable file.
 *
 * @param proposal The staged proposal.
 * @param options.workspace Validated workspace whose memory files count as targets.
 * @throws when the target is not on the allow-list or cannot be read.
 */
export async function previewProposal(
  proposal: SleepReviewProposal,
  options: { workspace?: string } = {}
): Promise<{ before: string; after: string }> {
  const target = await resolveAllowedTarget(proposal.targetPath, options.workspace);
  const before = await fs.readFile(target.path, 'utf8');
  const applied = applyEdit(before, proposal.edit);
  return { before, after: applied.content ?? before };
}

/**
 * Apply a staged proposal to disk behind a baseline-hash guard.
 *
 * The target is re-hashed first: if it drifted since the proposal was staged the
 * proposal is marked `failed` and nothing is written. Otherwise the current file
 * is copied into `backups/<id>/<basename>` before the edit lands.
 *
 * @returns The updated proposal (`accepted` or `failed`).
 */
export async function acceptProposal(
  store: SleepReviewStore,
  proposal: SleepReviewProposal,
  options: { workspace?: string } = {}
): Promise<SleepReviewProposal> {
  const fail = async (error: string): Promise<SleepReviewProposal> => {
    return (
      (await store.updateProposal(proposal.id, { status: 'failed', error })) ?? { ...proposal, status: 'failed', error }
    );
  };

  let target: SleepReviewTarget;
  try {
    target = await resolveAllowedTarget(proposal.targetPath, options.workspace);
  } catch (error) {
    return fail(toMessage(error));
  }

  let current: string;
  try {
    current = await fs.readFile(target.path, 'utf8');
  } catch (error) {
    return fail(`Target file could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (sha256(current) !== proposal.baselineSha256) {
    return fail('Target file changed since this proposal was staged. Re-run the review to get a fresh proposal.');
  }

  const applied = applyEdit(current, proposal.edit);
  if (applied.error || applied.content === undefined) return fail(applied.error ?? 'Edit could not be applied.');

  const backupPath = path.join(store.backupDir(proposal.id), path.basename(target.path));
  try {
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, current, 'utf8');
    await fs.writeFile(target.path, applied.content ?? current, 'utf8');
  } catch (error) {
    return fail(`Failed to apply edit: ${error instanceof Error ? error.message : String(error)}`);
  }

  const updated = await store.updateProposal(proposal.id, {
    status: 'accepted',
    appliedAt: Date.now(),
    backupPath,
    error: undefined,
  });
  return updated ?? { ...proposal, status: 'accepted', appliedAt: Date.now(), backupPath };
}

/**
 * Restore the pre-apply backup of an accepted proposal.
 *
 * @returns The updated proposal (`rolledBack` or `failed`).
 */
export async function rollbackProposal(
  store: SleepReviewStore,
  proposal: SleepReviewProposal,
  options: { workspace?: string } = {}
): Promise<SleepReviewProposal> {
  if (!proposal.backupPath) {
    const updated = await store.updateProposal(proposal.id, {
      status: 'failed',
      error: 'No backup exists for this proposal.',
    });
    return updated ?? { ...proposal, status: 'failed', error: 'No backup exists for this proposal.' };
  }

  let target: SleepReviewTarget;
  try {
    target = await resolveAllowedTarget(proposal.targetPath, options.workspace);
  } catch (error) {
    const message = toMessage(error);
    const rejected = await store.updateProposal(proposal.id, { status: 'failed', error: message });
    return rejected ?? { ...proposal, status: 'failed', error: message };
  }

  try {
    const backup = await fs.readFile(proposal.backupPath, 'utf8');
    await fs.writeFile(target.path, backup, 'utf8');
  } catch (error) {
    const message = `Rollback failed: ${error instanceof Error ? error.message : String(error)}`;
    const updated = await store.updateProposal(proposal.id, { status: 'failed', error: message });
    return updated ?? { ...proposal, status: 'failed', error: message };
  }

  const updated = await store.updateProposal(proposal.id, { status: 'rolledBack', error: undefined });
  return updated ?? { ...proposal, status: 'rolledBack' };
}
