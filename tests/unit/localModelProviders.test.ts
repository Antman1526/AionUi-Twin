import { describe, expect, it } from 'vitest';

import {
  DOCKER_MODEL_RUNNER_OPENAI_BASE_URL,
  LOCAL_OLLAMA_OPENAI_BASE_URL,
  getLocalProviderApiKey,
  isLocalModelProviderBaseUrl,
} from '@/common/utils/localModelProviders';

describe('local model provider helpers', () => {
  it('recognizes Ollama and Docker Model Runner localhost endpoints', () => {
    expect(isLocalModelProviderBaseUrl(LOCAL_OLLAMA_OPENAI_BASE_URL)).toBe(true);
    expect(isLocalModelProviderBaseUrl(DOCKER_MODEL_RUNNER_OPENAI_BASE_URL)).toBe(true);
    expect(isLocalModelProviderBaseUrl('http://127.0.0.1:12434/engines/v1')).toBe(true);
    expect(isLocalModelProviderBaseUrl('http://[::1]:12434/engines/v1')).toBe(true);
  });

  it('does not mark remote OpenAI-compatible endpoints as local', () => {
    expect(isLocalModelProviderBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLocalModelProviderBaseUrl('http://example.com:12434/engines/v1')).toBe(false);
    expect(isLocalModelProviderBaseUrl('not-a-url')).toBe(false);
  });

  it('provides harmless default API keys for local endpoints only', () => {
    expect(getLocalProviderApiKey(LOCAL_OLLAMA_OPENAI_BASE_URL)).toBe('ollama');
    expect(getLocalProviderApiKey(DOCKER_MODEL_RUNNER_OPENAI_BASE_URL)).toBe('not-needed');
    expect(getLocalProviderApiKey('https://api.openai.com/v1')).toBeUndefined();
  });
});
