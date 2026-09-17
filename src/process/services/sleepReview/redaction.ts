/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Outcome of redacting one block of transcript text. */
export type RedactionResult = {
  text: string;
  redactionCount: number;
};

type RedactionRule = {
  pattern: RegExp;
  /** Literal replacement, or a function that rewrites the whole match. */
  replacement: string | ((match: string) => string);
};

/**
 * Ordered redaction rules. Longer / more specific secrets run first so a generic
 * rule can never swallow half of a more specific match.
 */
const RULES: RedactionRule[] = [
  // Multi-line PEM blocks first: their base64 body would otherwise be chewed up
  // by the narrower token rules below.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // Anthropic keys must run before the generic OpenAI `sk-` rule.
  { pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /sk-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED_API_KEY]' },
  // Stripe-style underscore keys (`sk_live_`, `sk_test_`, `rk_live_`).
  { pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_KEY]' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_GITLAB_TOKEN]' },
  { pattern: /\bhf_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bnpm_[A-Za-z0-9]{36}/g, replacement: '[REDACTED_NPM_TOKEN]' },
  { pattern: /xox[abp]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  { pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: '[REDACTED_JWT]' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, replacement: 'Bearer [REDACTED_TOKEN]' },
  { pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{8,}/gi, replacement: 'Authorization: Basic [REDACTED_TOKEN]' },
  // Inline credentials in connection URLs. Runs before the email rule so
  // `user:pass@host` is not mistaken for an address.
  {
    pattern: /\b(?:postgresql|postgres|mongodb\+srv|mongodb|mysql|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/gi,
    replacement: (match) => match.replace(/\/\/[^@]+@$/, '//[REDACTED_CREDENTIALS]@'),
  },
  // Absolute home paths collapse to `~` so machine + account names never leak.
  { pattern: /\/(?:Users|home)\/[^/\s:'"]+/g, replacement: '~' },
  { pattern: /[A-Za-z]:\\Users\\[^\\\s:'"]+\\/g, replacement: '~/' },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  // Dotted quads preceded by `v` / `ver` / `version` are version numbers, not hosts.
  { pattern: /(?<!\b(?:v|ver|version)\s?)\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
  // Generic `key = value` assignments run last: everything above has already
  // replaced the values it recognises, and `[REDACTED…]` is skipped explicitly.
  {
    pattern:
      /\b(?:api[_-]?key|apikey|password|passwd|secret|access[_-]?token|client[_-]?secret|token)\s*[:=]\s*["']?(?!\[REDACTED)[^\s"',;]{8,}["']?/gi,
    replacement: (match) => match.replace(/([:=]\s*)["']?[^\s"',;]{8,}["']?$/, '$1[REDACTED_SECRET]'),
  },
];

/**
 * Strip credentials, personal identifiers, and absolute home paths from a transcript.
 *
 * Pure function — no IO, no globals. The main process must never hand raw
 * transcript text to the renderer or to a model prompt without running it
 * through this first.
 *
 * @param text Raw transcript text.
 * @returns The redacted text and the number of replacements performed.
 */
export function redactTranscript(text: string): RedactionResult {
  if (!text) return { text: '', redactionCount: 0 };

  let redacted = text;
  let redactionCount = 0;

  for (const rule of RULES) {
    const { replacement } = rule;
    redacted = redacted.replace(rule.pattern, (match: string) => {
      redactionCount += 1;
      return typeof replacement === 'string' ? replacement : replacement(match);
    });
  }

  return { text: redacted, redactionCount };
}
