/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { formatComparisonMarkdown } from '@renderer/pages/arena/formatComparison';

describe('formatComparisonMarkdown', () => {
  it('renders a metrics table and both answers', () => {
    const markdown = formatComparisonMarkdown({
      prompt: 'Explain TCP slow start.',
      left: {
        label: 'OpenAI · gpt-4o',
        text: 'Slow start ramps the congestion window.',
        stats: { ttfbMs: 120.4, totalMs: 120.4, outputTokens: 42, tokensPerSecond: 348.8 },
      },
      right: {
        label: 'Local · llama-3',
        text: 'It doubles cwnd each RTT.',
        stats: { ttfbMs: 900, totalMs: 900, outputTokens: 30, tokensPerSecond: 33.33, estimated: true },
      },
    });

    expect(markdown).toContain('| Metric | OpenAI · gpt-4o | Local · llama-3 |');
    expect(markdown).toContain('| Total time | 120 ms | 900 ms |');
    expect(markdown).toContain('| Output tokens | 42 | ≈30 |');
    expect(markdown).toContain('| Tokens/sec | 348.8 | ≈33.3 |');
    expect(markdown).toContain('## OpenAI · gpt-4o');
    expect(markdown).toContain('Slow start ramps the congestion window.');
    expect(markdown).toContain('It doubles cwnd each RTT.');
  });

  it('marks only estimated figures with ≈', () => {
    const markdown = formatComparisonMarkdown({
      prompt: 'hi',
      left: { label: 'A', text: 'a', stats: { ttfbMs: 1, totalMs: 1, outputTokens: 1, tokensPerSecond: 1000 } },
      right: { label: 'B', text: 'b' },
    });
    expect(markdown).toContain('| Output tokens | 1 | — |');
    expect(markdown).not.toContain('≈');
  });

  it('escapes pipes in labels so the table stays intact', () => {
    const markdown = formatComparisonMarkdown({
      prompt: 'hi',
      left: { label: 'a|b', text: 'x' },
      right: { label: 'c', text: 'y' },
    });
    expect(markdown).toContain('| Metric | a\\|b | c |');
  });

  it('includes the system prompt when one was used', () => {
    const markdown = formatComparisonMarkdown({
      prompt: 'hi',
      systemPrompt: 'Be terse.',
      left: { label: 'A', text: 'x' },
      right: { label: 'B', text: 'y' },
    });
    expect(markdown).toContain('**System prompt**');
    expect(markdown).toContain('> Be terse.');
  });

  it('shows the error instead of the body for a failed side', () => {
    const markdown = formatComparisonMarkdown({
      prompt: 'hi',
      left: { label: 'A', text: '', error: 'rate limited' },
      right: { label: 'B', text: 'y' },
    });
    expect(markdown).toContain('**Error:** rate limited');
  });
});
