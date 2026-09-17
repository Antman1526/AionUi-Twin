import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SleepReviewProposal } from '@/common/types/sleepReview';
import { atomicWriteJson, SleepReviewStore } from '@process/services/sleepReview/store';

let root: string;

const proposal = (id: string): SleepReviewProposal => ({
  id,
  createdAt: 1,
  targetPath: '/tmp/SKILL.md',
  targetKind: 'skill',
  baselineSha256: 'hash',
  status: 'staged',
  rationale: 'because',
  edit: { type: 'replace', anchor: 'x', before: 'a', after: 'b' },
  heldOutChecks: ['check one'],
  risk: 'low',
  rollback: 'restore backup',
  modelId: 'model-a',
  providerId: 'provider-a',
  sourceConversationIds: ['c1'],
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-review-store-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('atomicWriteJson', () => {
  it('creates missing directories and leaves no temp file behind', async () => {
    const target = path.join(root, 'nested', 'deep', 'data.json');
    await atomicWriteJson(target, { a: 1 });

    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ a: 1 });
    expect(await fs.readdir(path.dirname(target))).toEqual(['data.json']);
  });

  it('keeps the previous content when the new write replaces it', async () => {
    const target = path.join(root, 'data.json');
    await atomicWriteJson(target, [1]);
    await atomicWriteJson(target, [1, 2]);

    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual([1, 2]);
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('SleepReviewStore proposals', () => {
  it('returns an empty list before anything is stored', async () => {
    expect(await new SleepReviewStore(root).listProposals()).toEqual([]);
  });

  it('adds proposals newest-first and reads one back by id', async () => {
    const store = new SleepReviewStore(root);
    await store.addProposal(proposal('one'));
    await store.addProposal(proposal('two'));

    expect((await store.listProposals()).map((item) => item.id)).toEqual(['two', 'one']);
    expect((await store.getProposal('one'))?.rationale).toBe('because');
  });

  it('updates a stored proposal and persists the patch', async () => {
    const store = new SleepReviewStore(root);
    await store.addProposal(proposal('one'));

    const updated = await store.updateProposal('one', { status: 'accepted', appliedAt: 42 });
    expect(updated?.status).toBe('accepted');
    expect((await new SleepReviewStore(root).getProposal('one'))?.appliedAt).toBe(42);
  });

  it('returns undefined when updating an unknown id', async () => {
    const store = new SleepReviewStore(root);
    expect(await store.updateProposal('missing', { status: 'rejected' })).toBeUndefined();
  });
});

describe('SleepReviewStore held-out prompts', () => {
  it('falls back to the global file when the workspace has none', async () => {
    const store = new SleepReviewStore(root);
    const workspace = path.join(root, 'workspace');
    await fs.mkdir(workspace, { recursive: true });

    await store.saveHeldOutPrompts([{ id: 'g1', prompt: 'global prompt' }]);

    expect(await store.resolveHeldOutPath(workspace)).toBe(path.join(root, 'held-out-prompts.json'));
    expect(await store.listHeldOutPrompts(workspace)).toEqual([{ id: 'g1', prompt: 'global prompt' }]);
  });

  it('prefers the workspace file once it exists', async () => {
    const store = new SleepReviewStore(root);
    const workspace = path.join(root, 'workspace');
    await store.saveHeldOutPrompts([{ id: 'g1', prompt: 'global prompt' }]);
    await store.saveHeldOutPrompts([{ id: 'w1', prompt: 'workspace prompt' }], workspace);

    expect(await store.resolveHeldOutPath(workspace)).toBe(path.join(workspace, '.aionui', 'held-out-prompts.json'));
    expect(await store.listHeldOutPrompts(workspace)).toEqual([{ id: 'w1', prompt: 'workspace prompt' }]);
    expect(await store.listHeldOutPrompts()).toEqual([{ id: 'g1', prompt: 'global prompt' }]);
  });
});
