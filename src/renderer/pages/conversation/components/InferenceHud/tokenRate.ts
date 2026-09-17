/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** One reading of a monotonically growing token counter. */
export type TokenSample = {
  /** When the reading was taken, ms since epoch. */
  at: number;
  /** Tokens produced so far. */
  tokens: number;
};

/**
 * Generation speed across a series of counter readings.
 *
 * A counter that went down means the server started a new request, so the
 * series is no longer comparable and no rate is reported.
 *
 * @param samples Readings in chronological order.
 * @returns Tokens per second, or null when the series cannot yield a rate.
 */
export function computeTokensPerSecond(samples: TokenSample[]): number | null {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedMs = last.at - first.at;
  const deltaTokens = last.tokens - first.tokens;
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(deltaTokens)) return null;
  if (elapsedMs <= 0 || deltaTokens <= 0) return null;
  return (deltaTokens / elapsedMs) * 1000;
}

/**
 * Human-readable byte size for the memory pill.
 *
 * @param bytes Resident set size.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
