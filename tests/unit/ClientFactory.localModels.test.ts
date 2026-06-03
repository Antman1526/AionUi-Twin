/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { ClientFactory } from '../../src/common/api/ClientFactory';
import type { TProviderWithModel } from '../../src/common/config/storage';

const { mockChatCreate, mockOpenAIConstructor } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
  mockOpenAIConstructor: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCreate,
      },
    };

    constructor(config: { apiKey?: string; baseURL?: string }) {
      mockOpenAIConstructor(config);
      const key = config.apiKey;
      if (key === undefined || key.trim() === '') {
        throw new Error('Missing credentials');
      }
    }
  },
}));

describe('ClientFactory local model providers', () => {
  it('initializes an OpenAI-compatible client for a no-auth local LM Studio provider', async () => {
    mockChatCreate.mockResolvedValueOnce({
      id: 'chatcmpl-local',
      object: 'chat.completion',
      created: 1,
      model: 'local-model',
      choices: [],
    });

    const provider: TProviderWithModel = {
      id: 'local-lm-studio',
      platform: 'custom',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      modelProtocols: undefined,
      useModel: 'local-model',
    };

    const client = await ClientFactory.createRotatingClient(provider, {
      rotatingOptions: { maxRetries: 1, retryDelay: 0 },
    });

    await client.createChatCompletion({
      model: 'local-model',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://localhost:1234/v1',
        apiKey: expect.any(String),
      })
    );
    expect(mockChatCreate).toHaveBeenCalledOnce();
  });
});
