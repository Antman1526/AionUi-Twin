import { describe, expect, it } from 'vitest';
import { buildComparisonMarkdown, type Comparison } from '@renderer/pages/arena/comparison';

const LABELS = {
  prompt: 'Prompt',
  systemPrompt: 'System prompt',
  left: 'Model A',
  right: 'Model B',
  latency: 'Latency',
  tokens: 'Output tokens',
  speed: 'Speed',
  estimated: 'Token counts estimated from text length.',
};

function comparison(overrides: Partial<Comparison> = {}): Comparison {
  return {
    prompt: 'Explain quicksort',
    left: {
      label: 'OpenAI / gpt-4o',
      text: 'Pick a pivot.',
      stats: { ttfbMs: 1200, totalMs: 1200, outputTokens: 24, tokensPerSecond: 20 },
    },
    right: {
      label: 'Local / qwen',
      text: 'Partition the array.',
      stats: { ttfbMs: 800, totalMs: 800, outputTokens: 16, tokensPerSecond: 20 },
    },
    labels: LABELS,
    ...overrides,
  };
}

describe('buildComparisonMarkdown', () => {
  it('puts both models in one stats table and both answers below it', () => {
    const markdown = buildComparisonMarkdown(comparison());
    expect(markdown).toContain('| | OpenAI / gpt-4o | Local / qwen |');
    expect(markdown).toContain('| Latency | 1200 ms | 800 ms |');
    expect(markdown).toContain('### Model A — OpenAI / gpt-4o');
    expect(markdown).toContain('Partition the array.');
  });

  it('omits the system prompt section when there is none', () => {
    expect(buildComparisonMarkdown(comparison())).not.toContain('System prompt');
    expect(buildComparisonMarkdown(comparison({ systemPrompt: 'Be terse' }))).toContain('### System prompt');
  });

  it('flags estimated token counts once', () => {
    const markdown = buildComparisonMarkdown(
      comparison({
        left: {
          label: 'Local / qwen',
          text: 'x',
          stats: { ttfbMs: 100, totalMs: 100, outputTokens: 9, tokensPerSecond: 90, estimated: true },
        },
      })
    );
    expect(markdown).toContain('| Output tokens | ≈9 | 16 |');
    expect(markdown).toContain('> Token counts estimated from text length.');
  });

  it('shows the failure instead of stats for a side that errored', () => {
    const markdown = buildComparisonMarkdown(
      comparison({ right: { label: 'Local / qwen', text: '', error: 'rate limited' } })
    );
    expect(markdown).toContain('| Latency | 1200 ms | rate limited |');
    expect(markdown).toContain('| Output tokens | 24 | - |');
    expect(markdown).toContain('rate limited');
  });

  it('keeps a pipe in a model label from breaking the table', () => {
    const markdown = buildComparisonMarkdown(
      comparison({
        left: { label: 'a|b', text: 'x', stats: { ttfbMs: 1, totalMs: 1, outputTokens: 1, tokensPerSecond: 1 } },
      })
    );
    expect(markdown).toContain('| | a\\|b | Local / qwen |');
  });
});
