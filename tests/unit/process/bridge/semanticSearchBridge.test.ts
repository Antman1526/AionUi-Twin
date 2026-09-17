import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';

const store: Record<string, unknown> = {};

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData', on: vi.fn() },
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
  },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => {
    throw new Error('database-should-not-be-reached');
  }),
}));

const providerCallbacks: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('@/common', () => {
  const makeProvider = (name: string) => ({
    provider: vi.fn((cb: (...args: unknown[]) => unknown) => {
      providerCallbacks[name] = cb;
    }),
  });
  return {
    ipcBridge: {
      semanticSearch: {
        getSettings: makeProvider('getSettings'),
        setSettings: makeProvider('setSettings'),
        getStats: makeProvider('getStats'),
        query: makeProvider('query'),
        rebuildIndex: makeProvider('rebuildIndex'),
        indexWorkspace: makeProvider('indexWorkspace'),
        cancelIndex: makeProvider('cancelIndex'),
        clearIndex: makeProvider('clearIndex'),
        indexProgress: { emit: vi.fn() },
      },
    },
  };
});

import { initSemanticSearchBridge } from '@process/bridge/semanticSearchBridge';

type BridgeResult = { success: boolean; msg?: string };

const KNOWN_WORKSPACE = '/Users/dev/projects/alpha';

function fakeRepository(): IConversationRepository {
  const conversation = { id: 'c1', extra: { workspace: KNOWN_WORKSPACE } } as unknown as TChatConversation;
  return { listAllConversations: vi.fn(async () => [conversation]) } as unknown as IConversationRepository;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  initSemanticSearchBridge(fakeRepository());
});

describe('semanticSearch.indexWorkspace', () => {
  it('refuses a directory that is not any conversation workspace', async () => {
    const result = (await providerCallbacks.indexWorkspace({ workspacePath: '/Users/dev/.ssh' })) as BridgeResult;

    expect(result.success).toBe(false);
    expect(result.msg).toContain('not a known conversation workspace');
  });

  it('refuses a traversal out of a known workspace', async () => {
    const result = (await providerCallbacks.indexWorkspace({
      workspacePath: `${KNOWN_WORKSPACE}/..`,
    })) as BridgeResult;

    expect(result.success).toBe(false);
    expect(result.msg).toContain('not a known conversation workspace');
  });

  it('lets a known workspace through the allowlist', async () => {
    const result = (await providerCallbacks.indexWorkspace({
      workspacePath: `${KNOWN_WORKSPACE}/`,
    })) as BridgeResult;

    expect(result.success).toBe(false);
    // Past the allowlist: it now fails on the (mocked, unavailable) index store.
    expect(result.msg).not.toContain('not a known conversation workspace');
    expect(result.msg).toContain('database-should-not-be-reached');
  });
});

describe('semanticSearch.setSettings', () => {
  it('refuses an embedding model outside the local model directories', async () => {
    store['localModel.directories'] = ['/Users/dev/models'];

    const result = (await providerCallbacks.setSettings({ embeddingModelPath: '/etc/hosts' })) as BridgeResult;

    expect(result.success).toBe(false);
    expect(result.msg).toContain('outside the configured local model directories');
    expect(store['semanticSearch.embeddingModelPath']).toBeUndefined();
  });

  it('still allows clearing the configured embedding model', async () => {
    const result = (await providerCallbacks.setSettings({ embeddingModelPath: '' })) as BridgeResult;

    expect(result.success).toBe(true);
    expect(store['semanticSearch.embeddingModelPath']).toBe('');
  });
});
