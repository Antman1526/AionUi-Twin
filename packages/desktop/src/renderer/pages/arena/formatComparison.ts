/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ArenaSideStats } from '@/common/adapter/ipcBridge';

export type ArenaComparisonSide = {
  /** Human label, e.g. `OpenAI · gpt-4o`. */
  label: string;
  text: string;
  error?: string;
  stats?: ArenaSideStats;
};

export type ArenaComparisonInput = {
  prompt: string;
  systemPrompt?: string;
  left: ArenaComparisonSide;
  right: ArenaComparisonSide;
};

/** Pipes and newlines would break the table row they sit in. */
const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const ms = (value?: number): string => (value === undefined ? '—' : `${Math.round(value)} ms`);

const tokens = (stats?: ArenaSideStats): string => {
  if (!stats) return '—';
  return `${stats.estimated ? '≈' : ''}${stats.outputTokens}`;
};

const rate = (stats?: ArenaSideStats): string => {
  if (!stats) return '—';
  return `${stats.estimated ? '≈' : ''}${stats.tokensPerSecond.toFixed(1)}`;
};

/**
 * Render an arena run as a self-contained markdown document: the prompt, a
 * metrics table, and both answers. Estimated figures keep their `≈` marker so
 * a pasted comparison never passes an estimate off as measured.
 */
export function formatComparisonMarkdown(input: ArenaComparisonInput): string {
  const { prompt, systemPrompt, left, right } = input;
  const lines: string[] = ['# Model arena', ''];

  if (systemPrompt) {
    lines.push('**System prompt**', '', `> ${systemPrompt.replace(/\r?\n/g, '\n> ')}`, '');
  }
  lines.push('**Prompt**', '', `> ${prompt.replace(/\r?\n/g, '\n> ')}`, '');

  lines.push(
    `| Metric | ${cell(left.label)} | ${cell(right.label)} |`,
    '| --- | --- | --- |',
    `| Time to first byte | ${ms(left.stats?.ttfbMs)} | ${ms(right.stats?.ttfbMs)} |`,
    `| Total time | ${ms(left.stats?.totalMs)} | ${ms(right.stats?.totalMs)} |`,
    `| Output tokens | ${tokens(left.stats)} | ${tokens(right.stats)} |`,
    `| Tokens/sec | ${rate(left.stats)} | ${rate(right.stats)} |`,
    ''
  );

  for (const side of [left, right]) {
    lines.push(`## ${side.label}`, '');
    lines.push(side.error ? `**Error:** ${side.error}` : side.text.trim() || '_(empty response)_', '');
  }

  return lines.join('\n').trimEnd() + '\n';
}
