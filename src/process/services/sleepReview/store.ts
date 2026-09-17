/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getPlatformServices } from '@/common/platform';
import type { HeldOutPrompt, SleepReviewProposal } from '@/common/types/sleepReview';

const PROPOSALS_FILE = 'proposals.json';
const HELD_OUT_FILE = 'held-out-prompts.json';
const BACKUPS_DIR = 'backups';
const WORKSPACE_CONFIG_DIR = '.aionui';

/**
 * Write JSON to disk atomically: serialize to a sibling temp file, then rename.
 * A crash mid-write therefore leaves the previous file intact.
 *
 * @param filePath Destination file.
 * @param value Any JSON-serializable value.
 */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * JSON-file backed storage for staged proposals, pre-apply backups, and the
 * held-out prompt library. No database migration is involved.
 */
export class SleepReviewStore {
  private readonly root: string;

  /**
   * @param root Directory holding `proposals.json` and `backups/`.
   */
  constructor(root: string) {
    this.root = root;
  }

  /** Absolute path of `proposals.json`. */
  get proposalsPath(): string {
    return path.join(this.root, PROPOSALS_FILE);
  }

  /** Directory holding pre-apply copies for one proposal. */
  backupDir(proposalId: string): string {
    return path.join(this.root, BACKUPS_DIR, proposalId);
  }

  /** All proposals, newest first. */
  async listProposals(): Promise<SleepReviewProposal[]> {
    return readJsonArray<SleepReviewProposal>(this.proposalsPath);
  }

  /** Look up one proposal by id. */
  async getProposal(id: string): Promise<SleepReviewProposal | undefined> {
    const proposals = await this.listProposals();
    return proposals.find((proposal) => proposal.id === id);
  }

  /** Insert a new proposal at the head of the list. */
  async addProposal(proposal: SleepReviewProposal): Promise<SleepReviewProposal> {
    const proposals = await this.listProposals();
    await atomicWriteJson(this.proposalsPath, [proposal, ...proposals.filter((item) => item.id !== proposal.id)]);
    return proposal;
  }

  /**
   * Merge `patch` into the stored proposal.
   *
   * @returns The updated proposal, or `undefined` when the id is unknown.
   */
  async updateProposal(id: string, patch: Partial<SleepReviewProposal>): Promise<SleepReviewProposal | undefined> {
    const proposals = await this.listProposals();
    const index = proposals.findIndex((proposal) => proposal.id === id);
    if (index < 0) return undefined;
    const updated: SleepReviewProposal = { ...proposals[index], ...patch, id };
    proposals[index] = updated;
    await atomicWriteJson(this.proposalsPath, proposals);
    return updated;
  }

  /**
   * Resolve the held-out prompt file: the workspace copy when the workspace
   * already has one, otherwise the global fallback.
   */
  async resolveHeldOutPath(workspace?: string): Promise<string> {
    const globalPath = path.join(this.root, HELD_OUT_FILE);
    if (!workspace) return globalPath;
    const workspacePath = path.join(workspace, WORKSPACE_CONFIG_DIR, HELD_OUT_FILE);
    try {
      await fs.access(workspacePath);
      return workspacePath;
    } catch {
      return globalPath;
    }
  }

  /** Read the held-out prompt library for a workspace (falls back to global). */
  async listHeldOutPrompts(workspace?: string): Promise<HeldOutPrompt[]> {
    return readJsonArray<HeldOutPrompt>(await this.resolveHeldOutPath(workspace));
  }

  /**
   * Persist the held-out prompt library. When a workspace is given the prompts
   * are written into that workspace, creating the file on first save.
   */
  async saveHeldOutPrompts(prompts: HeldOutPrompt[], workspace?: string): Promise<HeldOutPrompt[]> {
    const target = workspace
      ? path.join(workspace, WORKSPACE_CONFIG_DIR, HELD_OUT_FILE)
      : path.join(this.root, HELD_OUT_FILE);
    await atomicWriteJson(target, prompts);
    return prompts;
  }
}

let defaultStore: SleepReviewStore | undefined;

/** Directory holding all sleep-review state under the app's user-data dir. */
export function getSleepReviewDir(): string {
  return path.join(getPlatformServices().paths.getDataDir(), 'sleep-review');
}

/** Lazily created process-wide store rooted at {@link getSleepReviewDir}. */
export function getSleepReviewStore(): SleepReviewStore {
  if (!defaultStore) defaultStore = new SleepReviewStore(getSleepReviewDir());
  return defaultStore;
}
