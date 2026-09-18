/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** One reading of the engine's cumulative decode counter. */
export type DecodeSample = {
  /** ms since epoch. */
  sampledAt: number;
  /** Cumulative decoded-token counter as reported by the engine. */
  decodedTokens: number;
};

/**
 * Throughput between the first and last sample, in tokens per second.
 *
 * Only the two ends of the window are read — intermediate samples are ignored,
 * which is why callers never need to keep more than two.
 *
 * Returns `null` (never a fabricated number) when the figure is not derivable:
 * fewer than two samples, a non-advancing clock, or a counter that went
 * backwards because the engine started a new generation.
 */
export function computeTokensPerSecond(samples: readonly DecodeSample[]): number | null {
  if (samples.length < 2) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];

  const elapsedMs = last.sampledAt - first.sampledAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;

  const decoded = last.decodedTokens - first.decodedTokens;
  if (!Number.isFinite(decoded) || decoded < 0) return null;

  return (decoded * 1000) / elapsedMs;
}
