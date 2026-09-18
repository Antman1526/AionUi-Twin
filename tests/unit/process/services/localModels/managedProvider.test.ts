// Target location: tests/unit/process/services/localModels/managedProvider.test.ts
//
// NOTE vs. the pre-existing baseline file at this path: only the import path
// was broken (top-level `../../../../../src/...` no longer exists after the
// move to `packages/desktop/src`) — fixed to use the `@process`/`@` aliases.
// The first assertion previously checked `managed.id` against the legacy
// `MANAGED_LOCAL_PROVIDER_PREFIX` ('local-llama-cpp-'), but
// `createLocalProviderFromRuntime` actually mints ids under the
// `local-managed-` prefix (see LocalModelRuntimeService.ts) — that assertion
// is corrected to use `isManagedLocalProvider`, the actual predicate this
// invariant is meant to exercise. Every other test/assertion is unchanged.

import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import {
  createLocalProviderFromRuntime,
  isManagedLocalProvider,
  replaceManagedProvider,
} from '@process/services/localModels/LocalModelRuntimeService';

function userProvider(id: string): IProvider {
  return { id, platform: 'custom', name: id, base_url: 'https://example.com/v1', api_key: 'sk-x', models: ['m'] };
}

describe('replaceManagedProvider', () => {
  const managed = createLocalProviderFromRuntime({
    runtime: 'llama.cpp',
    name: 'Qwen3.5-9B-Q4_K_M',
    baseUrl: 'http://127.0.0.1:18080/v1',
    models: ['Qwen3.5-9B-Q4_K_M'],
  });

  it('produces a managed id recognized by isManagedLocalProvider', () => {
    expect(isManagedLocalProvider(managed.id)).toBe(true);
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
    expect(result.filter((p) => isManagedLocalProvider(p.id))).toHaveLength(1);
    expect(result.map((p) => p.id)).toEqual(['user-a', second.id]);
  });

  it('removes the managed provider when next is null, keeping user providers', () => {
    const withManaged = replaceManagedProvider([userProvider('user-a')], managed);
    const result = replaceManagedProvider(withManaged, null);
    expect(result.map((p) => p.id)).toEqual(['user-a']);
  });
});
