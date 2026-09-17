import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { SleepReviewTarget } from '@/common/types/sleepReview';

/** Allow-list the guard sees; rewritten per test to simulate an unlisted target. */
const allowList: { targets: SleepReviewTarget[] } = { targets: [] };
const createRotatingClient = vi.fn();

vi.mock('@process/services/sleepReview/targets', () => ({
  listTargets: async () => allowList.targets,
}));

vi.mock('@/common/api/ClientFactory', () => ({
  ClientFactory: { createRotatingClient: (...args: unknown[]) => createRotatingClient(...args) },
}));

import { runReview } from '@process/services/sleepReview/runReview';
import { SleepReviewStore } from '@process/services/sleepReview/store';

const PROVIDERS: IProvider[] = [
  { id: 'provider-a', platform: 'openai', name: 'A', baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: ['m'] },
];

let root: string;
let readmePath: string;
let store: SleepReviewStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-review-run-'));
  readmePath = path.join(root, 'README.md');
  await fs.writeFile(readmePath, '# readme\n', 'utf8');
  allowList.targets = [{ path: readmePath, kind: 'memory', label: 'README.md' }];
  store = new SleepReviewStore(path.join(root, 'state'));
  createRotatingClient.mockReset();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const run = (targetPath: string) =>
  runReview(
    { conversationIds: [], targetPath, providerId: 'provider-a', modelId: 'm' },
    { store, providers: PROVIDERS, transcripts: [], heldOutPrompts: [], workspace: root }
  );

describe('runReview target allow-list', () => {
  it('rejects a path that is not a listed target, without reading it or calling a provider', async () => {
    const secret = path.join(root, 'secrets.env');
    await fs.writeFile(secret, 'TOKEN=abcdef\n', 'utf8');

    const result = await run(secret);

    expect(result.proposal).toBeUndefined();
    expect(result.error).toContain('Not an allowed Sleep Review target');
    expect(createRotatingClient).not.toHaveBeenCalled();
    expect(await store.listProposals()).toEqual([]);
  });

  it('rejects an absolute path outside the workspace', async () => {
    const result = await run('/etc/hosts');
    expect(result.error).toContain('Not an allowed Sleep Review target');
    expect(createRotatingClient).not.toHaveBeenCalled();
  });

  it('rejects a traversal path', async () => {
    const result = await run(path.join(root, '..', '..', 'etc', 'hosts'));
    expect(result.error).toContain('Not an allowed Sleep Review target');
    expect(createRotatingClient).not.toHaveBeenCalled();
  });

  it('accepts a listed target and stages a proposal from the model answer', async () => {
    createRotatingClient.mockResolvedValue({
      createChatCompletion: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rationale: 'why',
                edit: { type: 'add', anchor: '# readme', after: 'note' },
                heldOutChecks: ['check'],
                risk: 'low',
                rollback: 'restore',
              }),
            },
          },
        ],
      }),
    });

    const result = await run(readmePath);

    expect(result.error).toBeUndefined();
    expect(result.proposal?.targetPath).toBe(readmePath);
    expect(result.proposal?.targetKind).toBe('memory');
  });
});
