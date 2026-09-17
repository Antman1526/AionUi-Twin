import { beforeEach, describe, expect, it, vi } from 'vitest';

const getManagedServerStatus = vi.fn();
vi.mock('@process/services/localModels/LocalModelRuntimeService', () => ({
  getManagedServerStatus: () => getManagedServerStatus() as unknown,
}));

import {
  collectRuntimeMetrics,
  parsePsRssBytes,
  parseRssBytes,
  parseSlots,
  parseTasklistRssBytes,
  rssCommand,
  slotsUrl,
} from '@process/services/localModels/runtimeMetrics';

/**
 * Taken from the llama.cpp server README's `GET /slots` example (two slots).
 * Only the fields this code reads are kept verbatim; `params` is elided.
 */
const SLOTS_FIXTURE = [
  {
    id: 0,
    id_task: 135,
    n_ctx: 65536,
    speculative: false,
    is_processing: true,
    params: { n_predict: -1, stream: true },
    next_token: { has_next_token: true, has_new_line: false, n_remain: -1, n_decoded: 0 },
  },
  {
    id: 1,
    id_task: 0,
    n_ctx: 65536,
    speculative: false,
    is_processing: true,
    params: { n_predict: -1, stream: true },
    next_token: { has_next_token: true, has_new_line: true, n_remain: -1, n_decoded: 136 },
  },
];

describe('parseSlots', () => {
  it('reads the context window and decoded tokens from a /slots response', () => {
    expect(parseSlots(SLOTS_FIXTURE)).toEqual({
      contextSize: 65536,
      decodedTokens: 0,
      processing: true,
      slotCount: 2,
    });
  });

  it('prefers a busy slot over an idle one listed first', () => {
    const slots = [
      { ...SLOTS_FIXTURE[0], is_processing: false },
      { ...SLOTS_FIXTURE[1], is_processing: true },
    ];
    expect(parseSlots(slots)).toMatchObject({ decodedTokens: 136, processing: true });
  });

  it('treats a slot without next_token as zero decoded tokens', () => {
    expect(parseSlots([{ id: 0, n_ctx: 4096, is_processing: false }])).toMatchObject({
      contextSize: 4096,
      decodedTokens: 0,
    });
  });

  it('returns null when the payload is not a usable slot list', () => {
    expect(parseSlots([])).toBeNull();
    expect(parseSlots({ error: 'slots disabled' })).toBeNull();
    expect(parseSlots([{ id: 0, is_processing: true }])).toBeNull();
  });
});

describe('RSS parsers', () => {
  it('reads KiB from ps output and converts to bytes', () => {
    expect(parsePsRssBytes(' 1234567\n')).toBe(1234567 * 1024);
  });

  it('returns null when ps printed no number', () => {
    expect(parsePsRssBytes('\n')).toBeNull();
  });

  it('reads the memory column from tasklist CSV output', () => {
    const row = '"llama-server.exe","4312","Console","1","1,234,567 K"';
    expect(parseTasklistRssBytes(row)).toBe(1234567 * 1024);
  });

  it('accepts a localized thousands separator in tasklist output', () => {
    const row = '"llama-server.exe","4312","Console","1","1.234.567 K"';
    expect(parseTasklistRssBytes(row)).toBe(1234567 * 1024);
  });

  it('returns null when tasklist reports no matching process', () => {
    expect(parseTasklistRssBytes('INFO: No tasks are running which match the specified criteria.\n')).toBeNull();
  });

  it('picks the parser matching the platform', () => {
    expect(rssCommand('win32', 7).file).toBe('tasklist');
    expect(rssCommand('darwin', 7)).toEqual({ file: 'ps', args: ['-o', 'rss=', '-p', '7'] });
    expect(parseRssBytes('linux', ' 100\n')).toBe(100 * 1024);
  });
});

describe('slotsUrl', () => {
  it('drops the OpenAI path from the managed base URL', () => {
    expect(slotsUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/slots');
  });
});

describe('collectRuntimeMetrics', () => {
  beforeEach(() => {
    getManagedServerStatus.mockReset();
  });

  it('reports not running when no managed server is active', async () => {
    getManagedServerStatus.mockReturnValue(null);
    const metrics = await collectRuntimeMetrics();
    expect(metrics.running).toBe(false);
    expect(metrics.contextSize).toBeUndefined();
  });

  it('merges slot state and process memory into one sample', async () => {
    getManagedServerStatus.mockReturnValue({
      port: 8080,
      baseUrl: 'http://127.0.0.1:8080/v1',
      pid: 4312,
      alias: 'qwen',
      modelPath: '/models/qwen.gguf',
    });
    const metrics = await collectRuntimeMetrics({
      platform: 'darwin',
      fetchJson: () => Promise.resolve(SLOTS_FIXTURE),
      run: () => Promise.resolve(' 2048\n'),
    });
    expect(metrics).toMatchObject({
      running: true,
      pid: 4312,
      name: 'qwen',
      contextSize: 65536,
      rssBytes: 2048 * 1024,
    });
  });

  it('still reports memory when the slots endpoint is unreachable', async () => {
    getManagedServerStatus.mockReturnValue({
      port: 8080,
      baseUrl: 'http://127.0.0.1:8080/v1',
      pid: 4312,
      alias: 'qwen',
      modelPath: '/models/qwen.gguf',
    });
    const metrics = await collectRuntimeMetrics({
      platform: 'darwin',
      fetchJson: () => Promise.reject(new Error('ECONNREFUSED')),
      run: () => Promise.resolve(' 2048\n'),
    });
    expect(metrics.running).toBe(true);
    expect(metrics.contextSize).toBeUndefined();
    expect(metrics.rssBytes).toBe(2048 * 1024);
  });

  it('leaves memory out when the process tool fails', async () => {
    getManagedServerStatus.mockReturnValue({
      port: 8080,
      baseUrl: 'http://127.0.0.1:8080/v1',
      pid: 4312,
      alias: 'qwen',
      modelPath: '/models/qwen.gguf',
    });
    const metrics = await collectRuntimeMetrics({
      platform: 'darwin',
      fetchJson: () => Promise.resolve(SLOTS_FIXTURE),
      run: () => Promise.reject(new Error('ps: not found')),
    });
    expect(metrics.rssBytes).toBeUndefined();
    expect(metrics.contextSize).toBe(65536);
  });
});
