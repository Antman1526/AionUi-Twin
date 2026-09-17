import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepReviewProposal, SleepReviewTarget } from '@/common/types/sleepReview';

/** Allow-list the guard sees; rewritten per test to simulate an unlisted target. */
const allowList: { targets: SleepReviewTarget[] } = { targets: [] };

vi.mock('@process/services/sleepReview/targets', () => ({
  listTargets: async () => allowList.targets,
}));

import {
  acceptProposal,
  applyEdit,
  previewProposal,
  rollbackProposal,
  sha256,
} from '@process/services/sleepReview/applyEdit';
import { SleepReviewStore } from '@process/services/sleepReview/store';

const ORIGINAL = ['# Skill', '', '## Safety', 'Never delete files.', ''].join('\n');

let root: string;
let targetPath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-review-apply-'));
  targetPath = path.join(root, 'SKILL.md');
  await fs.writeFile(targetPath, ORIGINAL, 'utf8');
  allowList.targets = [{ path: targetPath, kind: 'skill', label: 'SKILL.md' }];
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const makeProposal = (overrides: Partial<SleepReviewProposal> = {}): SleepReviewProposal => ({
  id: 'p1',
  createdAt: 1,
  targetPath,
  targetKind: 'skill',
  baselineSha256: sha256(ORIGINAL),
  status: 'staged',
  rationale: 'because',
  edit: { type: 'replace', anchor: '## Safety', before: 'Never delete files.', after: 'Never delete user files.' },
  heldOutChecks: [],
  risk: 'low',
  rollback: 'restore backup',
  modelId: 'model-a',
  providerId: 'provider-a',
  sourceConversationIds: [],
  ...overrides,
});

describe('applyEdit', () => {
  it('inserts after the first line containing the anchor', () => {
    const result = applyEdit(ORIGINAL, { type: 'add', anchor: '## Safety', after: 'Always ask first.' });
    expect(result.error).toBeUndefined();
    expect(result.content).toBe(
      ['# Skill', '', '## Safety', 'Always ask first.', 'Never delete files.', ''].join('\n')
    );
  });

  it('fails when the anchor is missing', () => {
    const result = applyEdit(ORIGINAL, { type: 'add', anchor: '## Missing', after: 'text' });
    expect(result.content).toBeUndefined();
    expect(result.error).toContain('Anchor not found');
  });

  it('removes the `before` text on delete', () => {
    const result = applyEdit(ORIGINAL, { type: 'delete', anchor: '', before: 'Never delete files.\n' });
    expect(result.content).toBe(['# Skill', '', '## Safety', ''].join('\n'));
  });

  it('fails when the text to delete is not found', () => {
    const result = applyEdit(ORIGINAL, { type: 'delete', anchor: '', before: 'not present' });
    expect(result.content).toBeUndefined();
    expect(result.error).toContain('not found');
  });

  it('replaces the first occurrence exactly once', () => {
    const source = 'a\nTODO\nb\nTODO\n';
    const result = applyEdit(source, { type: 'replace', anchor: '', before: 'TODO', after: 'DONE' });
    expect(result.content).toBe('a\nDONE\nb\nTODO\n');
  });

  it('fails when the text to replace is not found', () => {
    const result = applyEdit(ORIGINAL, { type: 'replace', anchor: '', before: 'nope', after: 'yes' });
    expect(result.content).toBeUndefined();
    expect(result.error).toContain('not found');
  });
});

describe('acceptProposal', () => {
  it('applies the edit, backs up the original, and marks the proposal accepted', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal();
    await store.addProposal(proposal);

    const updated = await acceptProposal(store, proposal);

    expect(updated.status).toBe('accepted');
    expect(await fs.readFile(targetPath, 'utf8')).toContain('Never delete user files.');
    expect(updated.backupPath).toBeTruthy();
    expect(await fs.readFile(updated.backupPath as string, 'utf8')).toBe(ORIGINAL);
  });

  it('refuses to apply when the target drifted from the baseline hash', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal({ baselineSha256: sha256('something else') });
    await store.addProposal(proposal);

    const updated = await acceptProposal(store, proposal);

    expect(updated.status).toBe('failed');
    expect(updated.error).toContain('changed since this proposal was staged');
    expect(await fs.readFile(targetPath, 'utf8')).toBe(ORIGINAL);
  });

  it('fails without writing when `before` is not present in the target', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal({
      edit: { type: 'replace', anchor: '', before: 'missing text', after: 'x' },
    });
    await store.addProposal(proposal);

    const updated = await acceptProposal(store, proposal);

    expect(updated.status).toBe('failed');
    expect(await fs.readFile(targetPath, 'utf8')).toBe(ORIGINAL);
  });
});

describe('rollbackProposal', () => {
  it('restores the pre-apply backup', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal();
    await store.addProposal(proposal);
    const accepted = await acceptProposal(store, proposal);

    const rolledBack = await rollbackProposal(store, accepted);

    expect(rolledBack.status).toBe('rolledBack');
    expect(await fs.readFile(targetPath, 'utf8')).toBe(ORIGINAL);
  });

  it('fails when no backup exists', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal();
    await store.addProposal(proposal);

    const rolledBack = await rollbackProposal(store, proposal);

    expect(rolledBack.status).toBe('failed');
    expect(rolledBack.error).toContain('No backup');
  });
});

describe('allow-list enforcement', () => {
  /** A file that exists on disk but is not one of the listed review targets. */
  const makeUnlistedFile = async (): Promise<string> => {
    const unlisted = path.join(root, 'secrets.env');
    await fs.writeFile(unlisted, 'TOKEN=abcdef\n', 'utf8');
    return unlisted;
  };

  it('previewProposal refuses a stored target that is not on the allow-list', async () => {
    const unlisted = await makeUnlistedFile();
    await expect(previewProposal(makeProposal({ targetPath: unlisted }))).rejects.toThrow(
      'Not an allowed Sleep Review target'
    );
  });

  it('previewProposal refuses an absolute path outside the workspace', async () => {
    await expect(previewProposal(makeProposal({ targetPath: '/etc/hosts' }))).rejects.toThrow(
      'Not an allowed Sleep Review target'
    );
  });

  it('previewProposal refuses a traversal path', async () => {
    const escaped = path.join(root, '..', '..', 'etc', 'hosts');
    await expect(previewProposal(makeProposal({ targetPath: escaped }))).rejects.toThrow(
      'Not an allowed Sleep Review target'
    );
  });

  it('acceptProposal re-validates the stored target and never writes to it', async () => {
    const unlisted = await makeUnlistedFile();
    const store = new SleepReviewStore(root);
    const content = await fs.readFile(unlisted, 'utf8');
    const proposal = makeProposal({
      targetPath: unlisted,
      baselineSha256: sha256(content),
      edit: { type: 'replace', anchor: '', before: 'TOKEN=abcdef', after: 'TOKEN=pwned' },
    });
    await store.addProposal(proposal);

    const updated = await acceptProposal(store, proposal);

    expect(updated.status).toBe('failed');
    expect(updated.error).toContain('Not an allowed Sleep Review target');
    expect(await fs.readFile(unlisted, 'utf8')).toBe(content);
    expect(updated.backupPath).toBeUndefined();
  });

  it('acceptProposal refuses a target that was dropped from the allow-list after staging', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal();
    await store.addProposal(proposal);
    allowList.targets = [];

    const updated = await acceptProposal(store, proposal);

    expect(updated.status).toBe('failed');
    expect(updated.error).toContain('Not an allowed Sleep Review target');
    expect(await fs.readFile(targetPath, 'utf8')).toBe(ORIGINAL);
  });

  it('rollbackProposal refuses to restore over an unlisted target', async () => {
    const store = new SleepReviewStore(root);
    const proposal = makeProposal();
    await store.addProposal(proposal);
    const accepted = await acceptProposal(store, proposal);
    expect(accepted.status).toBe('accepted');

    const unlisted = await makeUnlistedFile();
    const content = await fs.readFile(unlisted, 'utf8');
    const hijacked = await store.updateProposal(accepted.id, { targetPath: unlisted });

    const rolledBack = await rollbackProposal(store, hijacked as SleepReviewProposal);

    expect(rolledBack.status).toBe('failed');
    expect(rolledBack.error).toContain('Not an allowed Sleep Review target');
    expect(await fs.readFile(unlisted, 'utf8')).toBe(content);
  });
});
