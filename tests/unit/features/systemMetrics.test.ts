import { describe, expect, it } from 'vitest';
import {
  estimateKvCacheBytes,
  evaluateModelHardwareFit,
  getSystemHardwareMetrics,
  isAppleSiliconMac,
} from '../../../packages/desktop/src/process/services/system/systemMetricsService';

describe('SystemMetricsService', () => {
  it('detects Apple Silicon or Darwin platform correctly', () => {
    const isApple = isAppleSiliconMac();
    expect(typeof isApple).toBe('boolean');
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      expect(isApple).toBe(true);
    }
  });

  it('retrieves system hardware metrics with valid RAM and CPU statistics', () => {
    const metrics = getSystemHardwareMetrics();
    expect(metrics.totalMemBytes).toBeGreaterThan(0);
    expect(metrics.freeMemBytes).toBeGreaterThan(0);
    expect(metrics.usedMemBytes).toBeGreaterThan(0);
    expect(metrics.totalMemBytes).toBeGreaterThanOrEqual(metrics.usedMemBytes);
    expect(typeof metrics.isAppleSilicon).toBe('boolean');
  });

  it('calculates KV cache memory overhead correctly', () => {
    const kv4k = estimateKvCacheBytes(4096);
    expect(kv4k).toBeGreaterThanOrEqual(268_435_456);

    const kv32k = estimateKvCacheBytes(32768);
    expect(kv32k).toBeGreaterThan(kv4k);
  });

  it('evaluates model hardware fit levels: optimal, partial, exceeded', () => {
    const tinyFit = evaluateModelHardwareFit(100 * 1024 * 1024);
    expect(tinyFit.level).toBe('optimal');
    expect(tinyFit.ratio).toBeLessThanOrEqual(0.7);

    const giantFit = evaluateModelHardwareFit(2 * 1024 * 1024 * 1024 * 1024);
    expect(giantFit.level).toBe('exceeded');
    expect(giantFit.ratio).toBeGreaterThan(0.92);
  });
});
