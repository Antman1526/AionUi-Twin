import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronBusyGuard } from '@process/services/cron/CronBusyGuard';

describe('CronBusyGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes pending idle callbacks when a conversation is removed', () => {
    const guard = new CronBusyGuard();
    const callback = vi.fn();

    guard.setProcessing('conv-1', true);
    guard.onceIdle('conv-1', callback);
    guard.remove('conv-1');
    guard.setProcessing('conv-1', false);

    expect(callback).not.toHaveBeenCalled();
  });

  it('clears pending idle callbacks during full reset', () => {
    const guard = new CronBusyGuard();
    const callback = vi.fn();

    guard.setProcessing('conv-1', true);
    guard.onceIdle('conv-1', callback);
    guard.clear();
    guard.setProcessing('conv-1', false);

    expect(callback).not.toHaveBeenCalled();
  });

  it('cleans up idle states and callbacks older than the retention window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'));

    const guard = new CronBusyGuard();
    const callback = vi.fn();

    guard.setProcessing('conv-1', true);
    guard.setProcessing('conv-1', false);
    guard.setProcessing('conv-1', true);
    guard.onceIdle('conv-1', callback);
    guard.setProcessing('conv-1', false);
    guard.setProcessing('conv-2', true);
    guard.onceIdle('conv-2', callback);
    guard.setProcessing('conv-2', false);

    vi.advanceTimersByTime(3_600_001);
    guard.cleanup(3_600_000);

    expect(guard.getAllStates().size).toBe(0);
  });
});
