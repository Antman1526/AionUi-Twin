/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@process/services/localModels/LocalModelRuntimeService', () => ({
  getManagedServerStatus: () => null,
}));

import {
  parsePsRss,
  parseSlots,
  parseTasklistRss,
  sampleRuntimeMetrics,
} from '@process/services/localModels/runtimeMetrics';

/**
 * Verbatim `GET /slots` example from llama.cpp's tools/server/README.md
 * ("Example with 2 slots"). Fetched from
 * https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md
 */
const SLOTS_FIXTURE: unknown = JSON.parse(`
  [
    {
      "id": 0,
      "id_task": 135,
      "n_ctx": 65536,
      "speculative": false,
      "is_processing": true,
      "params": {
        "n_predict": -1,
        "seed": 4294967295,
        "temperature": 0.800000011920929,
        "dynatemp_range": 0.0,
        "dynatemp_exponent": 1.0,
        "top_k": 40,
        "top_p": 0.949999988079071,
        "min_p": 0.05000000074505806,
        "top_n_sigma": -1.0,
        "xtc_probability": 0.0,
        "xtc_threshold": 0.10000000149011612,
        "typical_p": 1.0,
        "repeat_last_n": 64,
        "repeat_penalty": 1.0,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
        "dry_multiplier": 0.0,
        "dry_base": 1.75,
        "dry_allowed_length": 2,
        "dry_penalty_last_n": 131072,
        "mirostat": 0,
        "mirostat_tau": 5.0,
        "mirostat_eta": 0.10000000149011612,
        "max_tokens": -1,
        "n_keep": 0,
        "n_discard": 0,
        "ignore_eos": false,
        "stream": true,
        "n_probs": 0,
        "min_keep": 0,
        "chat_format": "GPT-OSS",
        "reasoning_format": "none",
        "reasoning_in_content": false,
        "generation_prompt": "",
        "samplers": [
          "penalties",
          "dry",
          "top_k",
          "typ_p",
          "top_p",
          "min_p",
          "xtc",
          "temperature"
        ],
        "speculative.n_max": 16,
        "speculative.n_min": 0,
        "speculative.p_min": 0.75,
        "timings_per_token": false,
        "post_sampling_probs": false,
        "lora": []
      },
      "next_token": {
        "has_next_token": true,
        "has_new_line": false,
        "n_remain": -1,
        "n_decoded": 0
      }
    },
    {
      "id": 1,
      "id_task": 0,
      "n_ctx": 65536,
      "speculative": false,
      "is_processing": true,
      "params": {
        "n_predict": -1,
        "seed": 4294967295,
        "temperature": 0.800000011920929,
        "dynatemp_range": 0.0,
        "dynatemp_exponent": 1.0,
        "top_k": 40,
        "top_p": 0.949999988079071,
        "min_p": 0.05000000074505806,
        "top_n_sigma": -1.0,
        "xtc_probability": 0.0,
        "xtc_threshold": 0.10000000149011612,
        "typical_p": 1.0,
        "repeat_last_n": 64,
        "repeat_penalty": 1.0,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
        "dry_multiplier": 0.0,
        "dry_base": 1.75,
        "dry_allowed_length": 2,
        "dry_penalty_last_n": 131072,
        "mirostat": 0,
        "mirostat_tau": 5.0,
        "mirostat_eta": 0.10000000149011612,
        "max_tokens": -1,
        "n_keep": 0,
        "n_discard": 0,
        "ignore_eos": false,
        "stream": true,
        "n_probs": 0,
        "min_keep": 0,
        "chat_format": "GPT-OSS",
        "reasoning_format": "none",
        "reasoning_in_content": false,
        "generation_prompt": "",
        "samplers": [
          "penalties",
          "dry",
          "top_k",
          "typ_p",
          "top_p",
          "min_p",
          "xtc",
          "temperature"
        ],
        "speculative.n_max": 16,
        "speculative.n_min": 0,
        "speculative.p_min": 0.75,
        "timings_per_token": false,
        "post_sampling_probs": false,
        "lora": []
      },
      "next_token": {
        "has_next_token": true,
        "has_new_line": true,
        "n_remain": -1,
        "n_decoded": 136
      }
    }
  ]
`);

describe('parseSlots', () => {
  it('reads context size, decoded tokens and processing state from the README fixture', () => {
    expect(parseSlots(SLOTS_FIXTURE)).toEqual({
      contextSize: 65536,
      // Slot 0 has decoded 0 tokens, slot 1 has decoded 136 — the aggregate is
      // what a tokens/sec delta needs.
      decodedTokens: 136,
      isProcessing: true,
    });
  });

  it('reports an idle server with no slot busy', () => {
    expect(parseSlots([{ id: 0, n_ctx: 4096, is_processing: false, next_token: { n_decoded: 0 } }])).toEqual({
      contextSize: 4096,
      decodedTokens: 0,
      isProcessing: false,
    });
  });

  it('omits fields the payload does not carry instead of inventing zeros', () => {
    expect(parseSlots([{ id: 0 }])).toEqual({ isProcessing: false });
  });

  it('returns null for a non-array payload', () => {
    expect(parseSlots({ error: 'slots endpoint is disabled' })).toBeNull();
    expect(parseSlots(null)).toBeNull();
    expect(parseSlots('[]')).toBeNull();
  });
});

describe('parsePsRss', () => {
  it('converts the KiB figure printed by `ps -o rss=` into bytes', () => {
    expect(parsePsRss('  412568\n')).toBe(412568 * 1024);
  });

  it('returns undefined when the process is gone (empty output)', () => {
    expect(parsePsRss('')).toBeUndefined();
    expect(parsePsRss('\n')).toBeUndefined();
  });
});

describe('parseTasklistRss', () => {
  it('reads the memory column of a CSV tasklist row', () => {
    const stdout = '"llama-server.exe","4312","Console","1","402,936 K"\n';
    expect(parseTasklistRss(stdout)).toBe(402936 * 1024);
  });

  it('handles a locale that uses a different thousands separator', () => {
    expect(parseTasklistRss('"llama-server.exe","4312","Console","1","402.936 K"')).toBe(402936 * 1024);
  });

  it('returns undefined when tasklist matched nothing', () => {
    expect(parseTasklistRss('INFO: No tasks are running which match the specified criteria.')).toBeUndefined();
  });

  it('returns undefined for an N/A memory column', () => {
    expect(parseTasklistRss('"llama-server.exe","4312","Console","1","N/A"')).toBeUndefined();
  });
});

describe('sampleRuntimeMetrics', () => {
  it('reports only a timestamp when no managed server is running', async () => {
    const metrics = await sampleRuntimeMetrics();
    expect(Object.keys(metrics)).toEqual(['sampledAt']);
    expect(metrics.sampledAt).toBeGreaterThan(0);
  });
});
