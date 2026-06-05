/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getApiKeyForModelList,
  getApiKeysForOpenAICompatibleClient,
  getFirstApiKey,
  isLocalBaseUrl,
  LOCAL_OPENAI_COMPATIBLE_API_KEY,
  normalizeModelDirectories,
  resolveModelDirectories,
} from '../../src/common/utils/localModelProviders';

describe('localModelProviders', () => {
  it('detects localhost OpenAI-compatible endpoints', () => {
    expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalBaseUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('uses a placeholder key only for no-auth local endpoints', () => {
    expect(getApiKeyForModelList('', 'http://localhost:11434/v1')).toBe(LOCAL_OPENAI_COMPATIBLE_API_KEY);
    expect(getApiKeysForOpenAICompatibleClient('', 'http://localhost:1234/v1')).toBe(LOCAL_OPENAI_COMPATIBLE_API_KEY);
    expect(getApiKeyForModelList('', 'https://api.openai.com/v1')).toBe('');
  });

  it('preserves user-provided API keys', () => {
    expect(getFirstApiKey(' sk-first,\nsk-second ')).toBe('sk-first');
    expect(getApiKeysForOpenAICompatibleClient('sk-first,\nsk-second', 'http://localhost:1234/v1')).toBe(
      'sk-first,\nsk-second'
    );
  });

  it('normalizes and resolves model directories without hardcoded machine paths', () => {
    expect(normalizeModelDirectories([' /a ', '/a', '', '   ', '/b'])).toEqual(['/a', '/b']);
    // Configured list wins; otherwise the caller-provided defaults are used.
    expect(resolveModelDirectories(['/custom'], ['/default'])).toEqual(['/custom']);
    expect(resolveModelDirectories([], ['/default'])).toEqual(['/default']);
    expect(resolveModelDirectories(undefined, undefined)).toEqual([]);
  });
});
