/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ArenaSideStats } from '@/common/adapter/ipcBridge';

/** One column of a finished comparison. */
export type ComparisonColumn = {
  /** Provider and model, as shown in the selector. */
  label: string;
  text: string;
  stats?: ArenaSideStats;
  error?: string;
};

/** Translated row headings, passed in so this stays pure and locale-agnostic. */
export type ComparisonLabels = {
  prompt: string;
  systemPrompt: string;
  left: string;
  right: string;
  latency: string;
  tokens: string;
  speed: string;
  estimated: string;
};

export type Comparison = {
  prompt: string;
  systemPrompt?: string;
  left: ComparisonColumn;
  right: ComparisonColumn;
  labels: ComparisonLabels;
};

/** Table cells cannot hold line breaks or unescaped pipes. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function latency(column: ComparisonColumn): string {
  if (column.error) return column.error;
  return column.stats ? `${String(Math.round(column.stats.totalMs))} ms` : '-';
}

function tokens(column: ComparisonColumn): string {
  if (!column.stats) return '-';
  return column.stats.estimated ? `≈${String(column.stats.outputTokens)}` : String(column.stats.outputTokens);
}

function speed(column: ComparisonColumn): string {
  if (!column.stats) return '-';
  return `${column.stats.tokensPerSecond.toFixed(1)} tok/s`;
}

/**
 * Render a comparison as markdown: a stats table followed by both answers.
 *
 * @returns Markdown ready to paste into an issue or a document.
 */
export function buildComparisonMarkdown(comparison: Comparison): string {
  const { labels, left, right } = comparison;
  const lines = [
    `## ${labels.prompt}`,
    '',
    comparison.prompt,
    '',
    ...(comparison.systemPrompt ? [`### ${labels.systemPrompt}`, '', comparison.systemPrompt, ''] : []),
    `| | ${cell(left.label)} | ${cell(right.label)} |`,
    '| --- | --- | --- |',
    `| ${labels.latency} | ${cell(latency(left))} | ${cell(latency(right))} |`,
    `| ${labels.tokens} | ${cell(tokens(left))} | ${cell(tokens(right))} |`,
    `| ${labels.speed} | ${cell(speed(left))} | ${cell(speed(right))} |`,
    '',
    ...(left.stats?.estimated || right.stats?.estimated ? [`> ${labels.estimated}`, ''] : []),
    `### ${labels.left} — ${left.label}`,
    '',
    left.error ?? left.text,
    '',
    `### ${labels.right} — ${right.label}`,
    '',
    right.error ?? right.text,
    '',
  ];
  return lines.join('\n');
}
