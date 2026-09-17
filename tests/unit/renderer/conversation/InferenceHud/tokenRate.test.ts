import { describe, expect, it } from 'vitest';
import {
  computeTokensPerSecond,
  formatBytes,
  type TokenSample,
} from '@renderer/pages/conversation/components/InferenceHud/tokenRate';

const at = (ms: number, tokens: number): TokenSample => ({ at: ms, tokens });

describe('computeTokensPerSecond', () => {
  it('measures the rate across the whole sample window', () => {
    expect(computeTokensPerSecond([at(0, 10), at(1000, 30), at(2000, 50)])).toBe(20);
  });

  it('needs at least two readings', () => {
    expect(computeTokensPerSecond([])).toBeNull();
    expect(computeTokensPerSecond([at(0, 10)])).toBeNull();
  });

  it('reports nothing when the counter did not move', () => {
    expect(computeTokensPerSecond([at(0, 10), at(1000, 10)])).toBeNull();
  });

  it('reports nothing when the counter went backwards after a new request', () => {
    expect(computeTokensPerSecond([at(0, 900), at(1000, 12)])).toBeNull();
  });

  it('reports nothing when two readings share a timestamp', () => {
    expect(computeTokensPerSecond([at(500, 10), at(500, 40)])).toBeNull();
  });
});

describe('formatBytes', () => {
  it('uses megabytes below one gigabyte', () => {
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB');
  });

  it('switches to gigabytes at one gigabyte', () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});
