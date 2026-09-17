import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';

const store: Record<string, unknown> = {};

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
  },
}));

/** Provider/emitter stubs that record the callbacks the bridge registers. */
const providerCallbacks: Record<string, (...args: unknown[]) => unknown> = {};
const emitted: Array<{ channel: string; payload: unknown }> = [];

vi.mock('@/common', () => {
  const makeProvider = (name: string) => ({
    provider: vi.fn((cb: (...args: unknown[]) => unknown) => {
      providerCallbacks[name] = cb;
    }),
  });
  const makeEmitter = (name: string) => ({
    emit: vi.fn((payload: unknown) => emitted.push({ channel: name, payload })),
  });
  return {
    ipcBridge: {
      localModel: {
        listModels: makeProvider('listModels'),
        start: makeProvider('start'),
        stop: makeProvider('stop'),
        getStatus: makeProvider('getStatus'),
        getDirectories: makeProvider('getDirectories'),
        setDirectories: makeProvider('setDirectories'),
        getRuntimeOptions: makeProvider('getRuntimeOptions'),
        setRuntimeOptions: makeProvider('setRuntimeOptions'),
        getExecutableStatus: makeProvider('getExecutableStatus'),
        setExecutablePath: makeProvider('setExecutablePath'),
        getModelInfo: makeProvider('getModelInfo'),
        getCatalog: makeProvider('getCatalog'),
        downloadCatalogModel: makeProvider('downloadCatalogModel'),
        cancelDownload: makeProvider('cancelDownload'),
        runtimeChanged: makeEmitter('runtimeChanged'),
        downloadProgress: makeEmitter('downloadProgress'),
      },
    },
  };
});

import { initLocalModelBridge, purgeStaleManagedProviders } from '@process/bridge/localModelBridge';

function provider(id: string): IProvider {
  return { id, platform: 'custom', name: id, baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: ['m'] };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  emitted.length = 0;
});

describe('purgeStaleManagedProviders', () => {
  it('removes managed llama.cpp providers left over from a previous run', async () => {
    store['model.config'] = [provider('user-a'), provider('local-llama-cpp-abc'), provider('user-b')];

    await purgeStaleManagedProviders();

    expect((store['model.config'] as IProvider[]).map((entry) => entry.id)).toEqual(['user-a', 'user-b']);
  });

  it('leaves the config untouched when no managed provider is present', async () => {
    const original = [provider('user-a')];
    store['model.config'] = original;

    await purgeStaleManagedProviders();

    expect(store['model.config']).toBe(original);
  });

  it('tolerates a missing model.config', async () => {
    await expect(purgeStaleManagedProviders()).resolves.toBeUndefined();
    expect(store['model.config']).toBeUndefined();
  });

  it('is run by initLocalModelBridge at startup', async () => {
    store['model.config'] = [provider('local-llama-cpp-stale'), provider('user-a')];

    initLocalModelBridge();
    await vi.waitFor(() => expect((store['model.config'] as IProvider[]).map((entry) => entry.id)).toEqual(['user-a']));
    expect(providerCallbacks.getExecutableStatus).toBeTypeOf('function');
  });
});

type BridgeResult = { success: boolean; msg?: string; data?: unknown };

const tempRoots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-bridge-security-'));
  tempRoots.push(root);
  return root;
}

async function call(name: string, payload: unknown): Promise<BridgeResult> {
  return (await providerCallbacks[name](payload)) as BridgeResult;
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

describe('localModel.setExecutablePath', () => {
  beforeEach(() => {
    initLocalModelBridge();
  });

  it('refuses a path that is not a llama-server binary', async () => {
    const result = await call('setExecutablePath', { path: '/bin/bash' });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('only llama-server');
    expect(store['localModel.executablePath']).toBeUndefined();
  });

  it('refuses a llama-server-named path that does not exist', async () => {
    const root = createRoot();

    const result = await call('setExecutablePath', { path: path.join(root, 'llama-server') });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('no such file');
    expect(store['localModel.executablePath']).toBeUndefined();
  });

  it('stores a real llama-server executable and allows clearing the override', async () => {
    const root = createRoot();
    const executable = path.join(root, 'llama-server');
    fs.writeFileSync(executable, '#!/bin/sh\n', { mode: 0o755 });

    expect((await call('setExecutablePath', { path: ` ${executable} ` })).success).toBe(true);
    expect(store['localModel.executablePath']).toBe(executable);

    expect((await call('setExecutablePath', { path: '' })).success).toBe(true);
    expect(store['localModel.executablePath']).toBe('');
  });
});

describe('localModel.setDirectories', () => {
  beforeEach(() => {
    initLocalModelBridge();
  });

  it('refuses a directory entry that is not an existing directory', async () => {
    const root = createRoot();
    const file = path.join(root, 'model.gguf');
    fs.writeFileSync(file, Buffer.alloc(1));

    const missing = await call('setDirectories', { directories: [path.join(root, 'nope')] });
    expect(missing.success).toBe(false);
    expect(missing.msg).toContain('Not a directory');

    const notADirectory = await call('setDirectories', { directories: [root, file] });
    expect(notADirectory.success).toBe(false);
    expect(notADirectory.msg).toContain('Not a directory');

    expect(store['localModel.directories']).toBeUndefined();
  });

  it('accepts existing directories', async () => {
    const root = createRoot();

    expect((await call('setDirectories', { directories: [root] })).success).toBe(true);
    expect(store['localModel.directories']).toEqual([root]);
  });
});

describe('localModel.start', () => {
  beforeEach(() => {
    initLocalModelBridge();
  });

  it('refuses a model outside the configured directories', async () => {
    const root = createRoot();
    const outside = createRoot();
    const modelPath = path.join(outside, 'model.gguf');
    fs.writeFileSync(modelPath, Buffer.alloc(1));
    store['localModel.directories'] = [root];

    const result = await call('start', { modelPath });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('outside the configured local model directories');
  });

  it('refuses a non-gguf file inside a configured directory', async () => {
    const root = createRoot();
    const script = path.join(root, 'x.sh');
    fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o755 });
    store['localModel.directories'] = [root];

    const result = await call('start', { modelPath: script });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('expected a .gguf file');
  });
});
