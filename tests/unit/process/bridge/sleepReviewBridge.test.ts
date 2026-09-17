import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { SleepReviewProposal, SleepReviewTarget } from '@/common/types/sleepReview';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';

/** Mutable fixtures the hoisted module mocks read at call time. */
const allowList: { targets: SleepReviewTarget[] } = { targets: [] };
const storeRef: { current: unknown } = { current: undefined };
const providerCallbacks: Record<string, (payload?: unknown) => Promise<unknown>> = {};

vi.mock('electron', () => ({ app: { getPath: () => '/mock/userData' } }));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: async () => [], set: async () => undefined },
}));

vi.mock('@process/services/sleepReview/targets', () => ({
  listTargets: async () => allowList.targets,
}));

vi.mock('@/common/api/ClientFactory', () => ({
  ClientFactory: { createRotatingClient: async () => ({ createChatCompletion: async () => ({ choices: [] }) }) },
}));

vi.mock('@process/services/sleepReview/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@process/services/sleepReview/store')>();
  return { ...actual, getSleepReviewStore: () => storeRef.current };
});

vi.mock('@/common', () => {
  const makeProvider = (name: string) => ({
    provider: (callback: (payload?: unknown) => Promise<unknown>) => {
      providerCallbacks[name] = callback;
    },
  });
  return {
    ipcBridge: {
      sleepReview: {
        listConversations: makeProvider('listConversations'),
        previewTranscript: makeProvider('previewTranscript'),
        listTargets: makeProvider('listTargets'),
        listProviders: makeProvider('listProviders'),
        run: makeProvider('run'),
        listProposals: makeProvider('listProposals'),
        previewProposal: makeProvider('previewProposal'),
        accept: makeProvider('accept'),
        reject: makeProvider('reject'),
        rollback: makeProvider('rollback'),
        listHeldOut: makeProvider('listHeldOut'),
        saveHeldOut: makeProvider('saveHeldOut'),
        runHeldOut: makeProvider('runHeldOut'),
      },
    },
  };
});

import { initSleepReviewBridge } from '@process/bridge/sleepReviewBridge';
import { sha256 } from '@process/services/sleepReview/applyEdit';
import { SleepReviewStore } from '@process/services/sleepReview/store';

type BridgeResult<T> = { success: boolean; msg?: string; data?: T };

const call = async <T>(channel: string, payload?: unknown): Promise<BridgeResult<T>> =>
  (await providerCallbacks[channel](payload)) as BridgeResult<T>;

let root: string;
let workspace: string;
let readmePath: string;
let store: SleepReviewStore;
let conversations: TChatConversation[];

/** Minimal repository stub: only the three methods the bridge uses. */
const repo = {
  getConversation: async (id: string) => conversations.find((conversation) => conversation.id === id),
  getMessages: async () => ({ data: [], total: 0, hasMore: false }),
  listAllConversations: async () => conversations,
} as unknown as IConversationRepository;

const makeProposal = (overrides: Partial<SleepReviewProposal> = {}): SleepReviewProposal => ({
  id: 'p1',
  createdAt: 1,
  targetPath: readmePath,
  targetKind: 'memory',
  baselineSha256: sha256('# readme\n'),
  status: 'staged',
  rationale: 'because',
  edit: { type: 'add', anchor: '# readme', after: 'note' },
  heldOutChecks: ['check'],
  risk: 'low',
  rollback: 'restore',
  modelId: 'm',
  providerId: 'provider-a',
  sourceConversationIds: ['c1'],
  ...overrides,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-review-bridge-'));
  workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  readmePath = path.join(workspace, 'README.md');
  await fs.writeFile(readmePath, '# readme\n', 'utf8');

  allowList.targets = [{ path: readmePath, kind: 'memory', label: 'README.md' }];
  store = new SleepReviewStore(path.join(root, 'state'));
  storeRef.current = store;
  conversations = [{ id: 'c1', name: 'chat', extra: { workspace } } as unknown as TChatConversation];

  initSleepReviewBridge(repo);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('sleepReview workspace validation', () => {
  it('saveHeldOut rejects a workspace no conversation uses and writes nothing', async () => {
    const attacker = path.join(root, 'attacker');
    await fs.mkdir(attacker, { recursive: true });

    const result = await call('saveHeldOut', { workspace: attacker, prompts: [{ id: 'h1', prompt: 'hello there' }] });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not a known workspace');
    await expect(fs.access(path.join(attacker, '.aionui'))).rejects.toThrow();
  });

  it('saveHeldOut accepts the workspace of an existing conversation', async () => {
    const result = await call('saveHeldOut', { workspace, prompts: [{ id: 'h1', prompt: 'hello there' }] });

    expect(result.success).toBe(true);
    const written = await fs.readFile(path.join(workspace, '.aionui', 'held-out-prompts.json'), 'utf8');
    expect(JSON.parse(written)).toEqual([{ id: 'h1', prompt: 'hello there' }]);
  });

  it('listHeldOut rejects an unknown workspace', async () => {
    const result = await call('listHeldOut', { workspace: path.join(root, 'elsewhere') });
    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not a known workspace');
  });

  it('listTargets rejects an unknown workspace', async () => {
    const result = await call('listTargets', { workspace: '/etc' });
    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not a known workspace');
  });

  it('listTargets still works without a workspace', async () => {
    const result = await call<SleepReviewTarget[]>('listTargets', {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual(allowList.targets);
  });
});

describe('sleepReview target validation', () => {
  it('run refuses a target that is not on the allow-list', async () => {
    const secret = path.join(workspace, 'secrets.env');
    await fs.writeFile(secret, 'TOKEN=abcdef\n', 'utf8');

    const result = await call('run', {
      conversationIds: ['c1'],
      targetPath: secret,
      providerId: 'provider-a',
      modelId: 'm',
    });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not an allowed Sleep Review target');
  });

  it('previewProposal refuses a stored target that is not on the allow-list', async () => {
    const secret = path.join(workspace, 'secrets.env');
    await fs.writeFile(secret, 'TOKEN=abcdef\n', 'utf8');
    await store.addProposal(makeProposal({ targetPath: secret }));

    const result = await call('previewProposal', { id: 'p1' });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not an allowed Sleep Review target');
  });

  it('runHeldOut refuses a stored target that is not on the allow-list', async () => {
    await store.addProposal(makeProposal({ targetPath: '/etc/hosts' }));

    const result = await call('runHeldOut', { proposalId: 'p1' });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not an allowed Sleep Review target');
  });

  it('accept refuses a stored target that is not on the allow-list and leaves it untouched', async () => {
    const secret = path.join(workspace, 'secrets.env');
    await fs.writeFile(secret, 'TOKEN=abcdef\n', 'utf8');
    await store.addProposal(
      makeProposal({
        targetPath: secret,
        baselineSha256: sha256('TOKEN=abcdef\n'),
        edit: { type: 'replace', anchor: '', before: 'TOKEN=abcdef', after: 'TOKEN=pwned' },
      })
    );

    const result = await call('accept', { id: 'p1' });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('Not an allowed Sleep Review target');
    expect(await fs.readFile(secret, 'utf8')).toBe('TOKEN=abcdef\n');
  });
});
