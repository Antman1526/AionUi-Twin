/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TProviderWithModel } from '../../src/common/config/storage';
import { LOCAL_OPENAI_COMPATIBLE_API_KEY } from '../../src/common/utils/localModelProviders';
import { buildSpawnConfig } from '../../src/process/agent/aionrs/envBuilder';

describe('aionrs envBuilder local model providers', () => {
  it('passes a placeholder API key for no-auth local OpenAI-compatible providers', () => {
    const provider: TProviderWithModel = {
      id: 'local-llama-cpp',
      platform: 'custom',
      name: 'Local Qwen',
      baseUrl: 'http://127.0.0.1:63843/v1',
      apiKey: '',
      model: ['Qwen3.5-9B-Q4_K_M'],
      useModel: 'Qwen3.5-9B-Q4_K_M',
      enabled: true,
    };

    const config = buildSpawnConfig(provider, { workspace: '/tmp/aionui-test' });

    expect(config.args).toContain('--base-url');
    expect(config.args).toContain('http://127.0.0.1:63843');
    expect(config.env.OPENAI_API_KEY).toBe(LOCAL_OPENAI_COMPATIBLE_API_KEY);
  });
});
