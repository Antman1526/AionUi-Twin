/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The whisper runtime must refuse any model path outside the allowed roots, so
 * a crafted IPC payload cannot make the process side spawn a server against an
 * arbitrary file.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { isPathInsideRoots, startWhisperServer } from '@process/services/whisper/WhisperRuntimeService';

describe('isPathInsideRoots', () => {
  it('accepts a model inside an allowed root', () => {
    expect(isPathInsideRoots('/models/whisper/ggml-base-q5_1.bin', ['/models/whisper'])).toBe(true);
    expect(isPathInsideRoots('/models/whisper/nested/m.bin', ['/other', '/models/whisper'])).toBe(true);
  });

  it('rejects traversal out of the allowed roots', () => {
    expect(isPathInsideRoots('/models/whisper/../../etc/passwd', ['/models/whisper'])).toBe(false);
    expect(isPathInsideRoots('/etc/passwd', ['/models/whisper'])).toBe(false);
    expect(isPathInsideRoots('/models/whisper-evil/m.bin', ['/models/whisper'])).toBe(false);
  });

  it('rejects everything when no root is configured', () => {
    expect(isPathInsideRoots('/models/whisper/m.bin', [])).toBe(false);
  });
});

describe('startWhisperServer', () => {
  it('refuses a jailed path before resolving any executable', async () => {
    await expect(startWhisperServer({ modelPath: '/etc/passwd', allowedRoots: ['/models/whisper'] })).rejects.toThrow(
      /outside the allowed whisper model directories/
    );
  });
});
