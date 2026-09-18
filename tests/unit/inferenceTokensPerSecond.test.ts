/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  computeTokensPerSecond,
  type DecodeSample,
} from '@renderer/components/layout/Titlebar/inferenceMetrics/tokensPerSecond';

describe('computeTokensPerSecond', () => {
  it('derives the rate from the first and last sample', () => {
    const samples: DecodeSample[] = [
      { sampledAt: 1_000, decodedTokens: 10 },
      { sampledAt: 3_000, decodedTokens: 70 },
    ];
    expect(computeTokensPerSecond(samples)).toBeCloseTo(30);
  });

  it('ignores intermediate samples — only the two ends matter', () => {
    const ends: DecodeSample[] = [
      { sampledAt: 0, decodedTokens: 0 },
      { sampledAt: 4_000, decodedTokens: 40 },
    ];
    const withMiddle: DecodeSample[] = [ends[0], { sampledAt: 1, decodedTokens: 999 }, ends[1]];
    expect(computeTokensPerSecond(withMiddle)).toBe(computeTokensPerSecond(ends));
  });

  it('returns null when the counter reset (a new generation started)', () => {
    expect(
      computeTokensPerSecond([
        { sampledAt: 1_000, decodedTokens: 120 },
        { sampledAt: 3_000, decodedTokens: 5 },
      ])
    ).toBeNull();
  });

  it('returns null for identical timestamps', () => {
    expect(
      computeTokensPerSecond([
        { sampledAt: 2_000, decodedTokens: 10 },
        { sampledAt: 2_000, decodedTokens: 90 },
      ])
    ).toBeNull();
  });

  it('returns null with fewer than two samples', () => {
    expect(computeTokensPerSecond([])).toBeNull();
    expect(computeTokensPerSecond([{ sampledAt: 1_000, decodedTokens: 10 }])).toBeNull();
  });

  it('returns 0 — not null — when the counter has not advanced', () => {
    expect(
      computeTokensPerSecond([
        { sampledAt: 1_000, decodedTokens: 42 },
        { sampledAt: 2_000, decodedTokens: 42 },
      ])
    ).toBe(0);
  });
});
