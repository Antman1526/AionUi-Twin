/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepReviewProposal } from '@/common/types/sleepReview';
import { applyEdit, sha256 } from '@process/services/sleepReview/editApply';
import { readHeldOutPrompts, writeHeldOutPrompts } from '@process/services/sleepReview/heldOutStore';
import {
  getProposal,
  readProposals,
  upsertProposal,
  writeFileAtomic,
} from '@process/services/sleepReview/proposalStore';
import {
  acceptProposal,
  previewProposal,
  rejectProposal,
  rollbackProposal,
  runHeldOut,
  runSleepReview,
  type SleepReviewDeps,
} from '@process/services/sleepReview/sleepReviewService';

const SKILL_BODY = ['# Demo skill', '', '## Rules', '', '- always read the file first', ''].join('\n');

let root: string;
let skillsDir: string;
let targetPath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-review-'));
  skillsDir = path.join(root, 'skills');
  targetPath = path.join(skillsDir, 'demo', 'SKILL.md');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, SKILL_BODY, 'utf8');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeDeps(complete: SleepReviewDeps['complete'] = () => Promise.resolve('')): SleepReviewDeps {
  return { rootDir: path.join(root, 'store'), skillsDir, complete };
}

const REPLACE_REPLY = JSON.stringify({
  rationale: 'the rule was too vague',
  edit: { type: 'replace', anchor: '## Rules', before: '- always read the file first', after: '- read the file first' },
  heldOutChecks: ['does it still mention reading?'],
  risk: 'none observed',
  rollback: 'restore the backup',
});

describe('writeFileAtomic', () => {
  it('writes the content and leaves no temporary file behind', async () => {
    const file = path.join(root, 'nested', 'data.json');
    await writeFileAtomic(file, '{"a":1}');

    expect(await fs.readFile(file, 'utf8')).toBe('{"a":1}');
    expect(await fs.readdir(path.dirname(file))).toEqual(['data.json']);
  });

  it('does not truncate the previous file when the write fails', async () => {
    const file = path.join(root, 'data.json');
    await writeFileAtomic(file, 'first');
    const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));

    await expect(writeFileAtomic(file, 'second')).rejects.toThrow('rename failed');
    expect(await fs.readFile(file, 'utf8')).toBe('first');
    expect((await fs.readdir(path.dirname(file))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    spy.mockRestore();
  });
});

describe('proposal store CRUD', () => {
  const base: SleepReviewProposal = {
    id: 'p1',
    createdAt: 1,
    targetPath: '/tmp/x/SKILL.md',
    targetKind: 'skill',
    baselineSha256: 'abc',
    status: 'staged',
    rationale: 'because',
    edit: { type: 'add', anchor: '## Rules', after: '- new rule' },
    heldOutChecks: [],
    risk: '',
    rollback: '',
    modelId: 'm',
    providerId: 'p',
    sourceConversationIds: [],
  };

  it('reads an empty list before anything is written', async () => {
    expect(await readProposals(path.join(root, 'store'))).toEqual([]);
  });

  it('inserts newest first and replaces by id', async () => {
    const dir = path.join(root, 'store');
    await upsertProposal(dir, base);
    await upsertProposal(dir, { ...base, id: 'p2' });
    expect((await readProposals(dir)).map((entry) => entry.id)).toEqual(['p2', 'p1']);

    await upsertProposal(dir, { ...base, status: 'rejected' });
    expect((await getProposal(dir, 'p1'))?.status).toBe('rejected');
    expect(await readProposals(dir)).toHaveLength(2);
  });

  it('reads an empty list from a corrupt file rather than throwing', async () => {
    const dir = path.join(root, 'store');
    await writeFileAtomic(path.join(dir, 'proposals.json'), 'not json');
    expect(await readProposals(dir)).toEqual([]);
  });
});

describe('applyEdit', () => {
  it('inserts after the first line containing the anchor', () => {
    expect(applyEdit(SKILL_BODY, { type: 'add', anchor: '## Rules', after: '- new rule' })).toContain(
      '## Rules\n- new rule'
    );
  });

  it('removes the text of a delete edit', () => {
    expect(applyEdit(SKILL_BODY, { type: 'delete', anchor: '', before: '- always read the file first' })).not.toContain(
      'always read'
    );
  });

  it('swaps the text of a replace edit exactly once', () => {
    const doubled = 'x\nkeep\nkeep\n';
    expect(applyEdit(doubled, { type: 'replace', anchor: '', before: 'keep', after: 'gone' })).toBe('x\ngone\nkeep\n');
  });

  it('fails when the anchor of an add edit is missing', () => {
    expect(() => applyEdit(SKILL_BODY, { type: 'add', anchor: '## Nope', after: 'x' })).toThrow(/Anchor not found/);
  });

  it('fails when the text of a delete edit is missing', () => {
    expect(() => applyEdit(SKILL_BODY, { type: 'delete', anchor: '', before: 'absent' })).toThrow(/was not found/);
  });

  it('fails when the text of a replace edit is missing', () => {
    expect(() => applyEdit(SKILL_BODY, { type: 'replace', anchor: '', before: 'absent', after: 'x' })).toThrow(
      /was not found/
    );
  });
});

describe('runSleepReview / accept / rollback', () => {
  it('stages a proposal with the baseline hash and never touches the file', async () => {
    const proposal = await runSleepReview(
      { targetPath, transcripts: [{ conversationId: 'c1', title: 't', text: 'body' }], providerId: 'p', modelId: 'm' },
      makeDeps(() => Promise.resolve(`sure thing!\n${REPLACE_REPLY}\nhope that helps`))
    );

    expect(proposal.status).toBe('staged');
    expect(proposal.baselineSha256).toBe(sha256(SKILL_BODY));
    expect(proposal.sourceConversationIds).toEqual(['c1']);
    expect(await fs.readFile(targetPath, 'utf8')).toBe(SKILL_BODY);
  });

  it('produces a unified diff without writing to the target', async () => {
    const deps = makeDeps(() => Promise.resolve(REPLACE_REPLY));
    const staged = await runSleepReview({ targetPath, transcripts: [], providerId: 'p', modelId: 'm' }, deps);

    const diff = await previewProposal(staged.id, deps);
    expect(diff.patch).toContain('-- always read the file first');
    expect(diff.patch).toContain('+- read the file first');
    expect(await fs.readFile(targetPath, 'utf8')).toBe(SKILL_BODY);
  });

  it('backs up, applies and then restores the file', async () => {
    const deps = makeDeps(() => Promise.resolve(REPLACE_REPLY));
    const staged = await runSleepReview({ targetPath, transcripts: [], providerId: 'p', modelId: 'm' }, deps);

    const accepted = await acceptProposal(staged.id, deps);
    expect(accepted.status).toBe('accepted');
    expect(accepted.backupPath).toBeTruthy();
    expect(await fs.readFile(targetPath, 'utf8')).toContain('- read the file first');

    const rolledBack = await rollbackProposal(staged.id, deps);
    expect(rolledBack.status).toBe('rolledBack');
    expect(await fs.readFile(targetPath, 'utf8')).toBe(SKILL_BODY);
  });

  it('refuses to accept after the target drifted and records the failure', async () => {
    const deps = makeDeps(() => Promise.resolve(REPLACE_REPLY));
    const staged = await runSleepReview({ targetPath, transcripts: [], providerId: 'p', modelId: 'm' }, deps);
    await fs.writeFile(targetPath, `${SKILL_BODY}\n- edited by hand\n`, 'utf8');

    await expect(acceptProposal(staged.id, deps)).rejects.toThrow(/changed after this proposal was staged/);
    expect((await getProposal(deps.rootDir, staged.id))?.status).toBe('failed');
    expect(await fs.readFile(targetPath, 'utf8')).toContain('edited by hand');
  });

  it('marks a proposal rejected without reading the target', async () => {
    const deps = makeDeps(() => Promise.resolve(REPLACE_REPLY));
    const staged = await runSleepReview({ targetPath, transcripts: [], providerId: 'p', modelId: 'm' }, deps);
    expect((await rejectProposal(staged.id, deps)).status).toBe('rejected');
  });
});

describe('held-out prompts', () => {
  it('round-trips through the global file and drops malformed entries', async () => {
    const dir = path.join(root, 'store');
    await writeHeldOutPrompts(dir, [
      { id: 'a', prompt: 'summarize the diff' },
      { id: '', prompt: 'no id' },
      { id: 'b', prompt: '   ' },
    ] as never);

    expect(await readHeldOutPrompts(dir)).toEqual([{ id: 'a', prompt: 'summarize the diff' }]);
  });

  it('writes a workspace set under .aionui/', async () => {
    const workspace = path.join(root, 'ws');
    await fs.mkdir(workspace, { recursive: true });
    await writeHeldOutPrompts(path.join(root, 'store'), [{ id: 'a', prompt: 'p' }], workspace);

    expect(await fs.readFile(path.join(workspace, '.aionui', 'held-out-prompts.json'), 'utf8')).toContain('"a"');
  });

  it('replays each prompt against the before and after content', async () => {
    const dir = path.join(root, 'store');
    await writeHeldOutPrompts(dir, [{ id: 'h1', prompt: 'what is rule one?' }]);

    const seen: string[] = [];
    const deps: SleepReviewDeps = {
      rootDir: dir,
      skillsDir,
      complete: ({ prompt }) => {
        seen.push(prompt);
        return Promise.resolve(prompt.includes('- read the file first') ? 'after answer' : 'before answer');
      },
    };
    const staged = await runSleepReview(
      { targetPath, transcripts: [], providerId: 'p', modelId: 'm' },
      {
        ...deps,
        complete: () => Promise.resolve(REPLACE_REPLY),
      }
    );

    const results = await runHeldOut(staged.id, deps);
    expect(results).toHaveLength(1);
    expect(results[0].beforeOutput).toBe('before answer');
    expect(results[0].afterOutput).toBe('after answer');
    expect(seen).toHaveLength(2);
  });
});
