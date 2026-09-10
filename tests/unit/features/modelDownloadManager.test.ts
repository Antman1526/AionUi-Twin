import { describe, expect, it, vi } from 'vitest';
import {
  cancelModelDownload,
  getActiveDownloads,
  startModelDownload,
} from '../../../packages/desktop/src/process/services/hfHub/modelDownloadManager';

describe('ModelDownloadManager', () => {
  it('initializes a download and registers active tracking', async () => {
    // Stub fetch with an unresolved or slow stream so we can inspect active state
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    const { downloadId } = await startModelDownload({
      modelId: 'test-org/test-model-gguf',
      fileName: 'test-model-q4.gguf',
      isMlx: false,
    });

    expect(downloadId).toBeDefined();
    expect(typeof downloadId).toBe('string');

    const activeList = getActiveDownloads();
    const current = activeList.find((d) => d.downloadId === downloadId);
    expect(current).toBeDefined();
    expect(current?.modelId).toBe('test-org/test-model-gguf');
    expect(current?.fileName).toBe('test-model-q4.gguf');

    // Test cancellation
    const cancelled = cancelModelDownload(downloadId);
    expect(cancelled).toBe(true);
    expect(getActiveDownloads().find((d) => d.downloadId === downloadId)).toBeUndefined();
  });
});
