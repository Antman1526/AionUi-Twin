import { describe, expect, it } from 'vitest';
import type { IProvider } from '../../../../../src/common/config/storage';
import {
  MANAGED_LOCAL_PROVIDER_PREFIX,
  createLocalProviderFromRuntime,
  replaceManagedProvider,
} from '../../../../../src/process/services/localModels/LocalModelRuntimeService';

function userProvider(id: string): IProvider {
  return { id, platform: 'custom', name: id, baseUrl: 'https://example.com/v1', apiKey: 'sk-x', model: ['m'] };
}

describe('replaceManagedProvider', () => {
  const managed = createLocalProviderFromRuntime({
    runtime: 'llama.cpp',
    name: 'Qwen3.5-9B-Q4_K_M',
    baseUrl: 'http://127.0.0.1:18080/v1',
    models: ['Qwen3.5-9B-Q4_K_M'],
  });

  it('produces a managed id that carries the managed prefix', () => {
    expect(managed.id.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX)).toBe(true);
  });

  it('adds the managed provider while preserving user providers', () => {
    const list = [userProvider('user-a'), userProvider('user-b')];
    const result = replaceManagedProvider(list, managed);
    expect(result.map((p) => p.id)).toEqual(['user-a', 'user-b', managed.id]);
  });

  it('replaces a previous managed provider instead of duplicating it', () => {
    const first = replaceManagedProvider([userProvider('user-a')], managed);
    const second = createLocalProviderFromRuntime({
      runtime: 'llama.cpp',
      name: 'Other',
      baseUrl: 'http://127.0.0.1:9090/v1',
      models: ['Other'],
    });
    const result = replaceManagedProvider(first, second);
    expect(result.filter((p) => p.id.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX))).toHaveLength(1);
    expect(result.map((p) => p.id)).toEqual(['user-a', second.id]);
  });

  it('removes the managed provider when next is null, keeping user providers', () => {
    const withManaged = replaceManagedProvider([userProvider('user-a')], managed);
    const result = replaceManagedProvider(withManaged, null);
    expect(result.map((p) => p.id)).toEqual(['user-a']);
  });
});
