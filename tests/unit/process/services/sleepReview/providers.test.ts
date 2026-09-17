import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { isLocalProviderForReview } from '@process/services/sleepReview/providers';
import { resolveProvider } from '@process/services/sleepReview/runReview';

const provider = (overrides: Partial<IProvider>): IProvider =>
  ({
    id: 'p1',
    platform: 'openai',
    name: 'Cloud',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'key',
    model: ['gpt-4o'],
    ...overrides,
  }) as IProvider;

describe('isLocalProviderForReview', () => {
  it('accepts the app-managed llama.cpp provider by id prefix', () => {
    expect(isLocalProviderForReview(provider({ id: 'local-llama-cpp-qwen', baseUrl: 'https://example.com' }))).toBe(
      true
    );
  });

  it('accepts loopback base URLs', () => {
    expect(isLocalProviderForReview(provider({ baseUrl: 'http://127.0.0.1:8080/v1' }))).toBe(true);
    expect(isLocalProviderForReview(provider({ baseUrl: 'http://localhost:11434/v1' }))).toBe(true);
  });

  it('accepts known local runtime platforms', () => {
    expect(isLocalProviderForReview(provider({ platform: 'ollama', baseUrl: 'https://remote.example/v1' }))).toBe(true);
    expect(isLocalProviderForReview(provider({ platform: 'LMStudio', baseUrl: 'https://remote.example/v1' }))).toBe(
      true
    );
  });

  it('rejects ordinary cloud providers', () => {
    expect(isLocalProviderForReview(provider({}))).toBe(false);
  });
});

describe('resolveProvider local-only filter', () => {
  const providers = [
    provider({ id: 'cloud', name: 'Cloud' }),
    provider({ id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:8080/v1' }),
  ];

  it('refuses a non-local provider when localOnly is set', () => {
    const result = resolveProvider(providers, 'cloud', 'gpt-4o', true);
    expect(result.provider).toBeUndefined();
    expect(result.error).toContain('is not local');
  });

  it('allows a local provider when localOnly is set', () => {
    const result = resolveProvider(providers, 'local', 'qwen', true);
    expect(result.error).toBeUndefined();
    expect(result.provider?.useModel).toBe('qwen');
  });

  it('allows any configured provider when localOnly is off', () => {
    expect(resolveProvider(providers, 'cloud', 'gpt-4o').provider?.id).toBe('cloud');
  });

  it('reports an unknown provider id', () => {
    expect(resolveProvider(providers, 'missing', 'gpt-4o').error).toContain('Provider not found');
  });
});
