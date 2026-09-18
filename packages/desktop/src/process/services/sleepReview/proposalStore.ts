/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SleepReviewProposal } from '@/common/types/sleepReview';

const PROPOSALS_FILE = 'proposals.json';
const BACKUPS_DIR = 'backups';

/**
 * Write `content` to `filePath` without ever leaving a truncated file behind.
 *
 * The temp name carries random bytes so two concurrent writers cannot collide
 * on it, and `rename` within the same directory is atomic on every platform the
 * app ships to.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await fs.rm(temporaryPath, { force: true });
    } catch {
      /* best effort — the temp file is already unreachable */
    }
    throw error;
  }
}

/** JSON file that holds every proposal, newest first. */
export function proposalsFilePath(rootDir: string): string {
  return path.join(rootDir, PROPOSALS_FILE);
}

/** Where the pre-edit copy of `targetPath` is kept for a given proposal. */
export function backupPathFor(rootDir: string, proposalId: string, targetPath: string): string {
  return path.join(rootDir, BACKUPS_DIR, proposalId, path.basename(targetPath));
}

/** Read every stored proposal. A missing or corrupt file reads as empty. */
export async function readProposals(rootDir: string): Promise<SleepReviewProposal[]> {
  try {
    const raw = await fs.readFile(proposalsFilePath(rootDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SleepReviewProposal[]) : [];
  } catch {
    return [];
  }
}

/** Replace the whole proposal list in one atomic write. */
export async function writeProposals(rootDir: string, proposals: readonly SleepReviewProposal[]): Promise<void> {
  await writeFileAtomic(proposalsFilePath(rootDir), `${JSON.stringify(proposals, null, 2)}\n`);
}

/** One proposal by id, or null. */
export async function getProposal(rootDir: string, proposalId: string): Promise<SleepReviewProposal | null> {
  return (await readProposals(rootDir)).find((proposal) => proposal.id === proposalId) ?? null;
}

/** Insert a new proposal (newest first) or replace the stored one with the same id. */
export async function upsertProposal(rootDir: string, proposal: SleepReviewProposal): Promise<SleepReviewProposal> {
  const proposals = await readProposals(rootDir);
  const index = proposals.findIndex((entry) => entry.id === proposal.id);
  if (index < 0) {
    proposals.unshift(proposal);
  } else {
    proposals[index] = proposal;
  }
  await writeProposals(rootDir, proposals);
  return proposal;
}

/** Copy the current target file aside so `rollback` has something to restore. */
export async function backupTarget(rootDir: string, proposalId: string, targetPath: string): Promise<string> {
  const destination = backupPathFor(rootDir, proposalId, targetPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(targetPath, destination);
  return destination;
}
