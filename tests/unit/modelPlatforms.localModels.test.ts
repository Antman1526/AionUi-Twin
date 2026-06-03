/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getPlatformByValue, MODEL_PLATFORMS } from '../../src/renderer/utils/model/modelPlatforms';

describe('local model platform presets', () => {
  it('includes Ollama and LM Studio presets with OpenAI-compatible local endpoints', () => {
    expect(getPlatformByValue('Ollama')).toEqual(
      expect.objectContaining({
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        platform: 'custom',
      })
    );
    expect(getPlatformByValue('LM-Studio')).toEqual(
      expect.objectContaining({
        name: 'LM Studio',
        baseUrl: 'http://localhost:1234/v1',
        platform: 'custom',
      })
    );
  });

  it('places local model presets near the top of the provider picker', () => {
    const names = MODEL_PLATFORMS.slice(0, 5).map((platform) => platform.name);

    expect(names).toContain('Ollama');
    expect(names).toContain('LM Studio');
  });
});
