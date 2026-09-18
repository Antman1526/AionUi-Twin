/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Secret redaction for sleep-review transcripts.
 *
 * Raw transcript text must never leave the process layer: everything the
 * renderer or a model sees goes through {@link redactSecrets} first. The module
 * is deliberately dependency-free and pure so it can be exhaustively tested.
 */

/** Every replacement this module writes starts with this marker. */
export const REDACTION_PLACEHOLDER_PREFIX = '[redacted:';

export type RedactionResult = {
  text: string;
  /** Number of individual secrets replaced. */
  redactionCount: number;
};

const mask = (kind: string): string => `${REDACTION_PLACEHOLDER_PREFIX}${kind}]`;

type Rule = {
  name: string;
  pattern: RegExp;
  /** Returns the replacement, or `null` to leave the match untouched (not counted). */
  replace: (match: RegExpMatchArray) => string | null;
};

/** True when every dotted group is a valid 0-255 octet. */
function isIpv4(candidate: string): boolean {
  const parts = candidate.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (part.length > 3) return false;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

/**
 * Ordered rule list. Order is load-bearing:
 *
 * 1. Multi-line PEM blocks first — an inner line would otherwise be shredded by
 *    a narrower rule and the `-----END` marker left dangling.
 * 2. Header rules (`Bearer`, `Authorization: Basic`) before the token shapes
 *    they carry, so the header name survives in the output.
 * 3. Vendor key shapes before the generic `key = value` rule, and the longer
 *    vendor prefixes (`sk-ant-`, `sk-proj-`) before the shorter `sk-`.
 * 4. Connection strings before the e-mail rule, so `user:pass@host` is not
 *    mistaken for an address.
 * 5. Home directories last, because a path may appear inside anything above.
 */
const RULES: Rule[] = [
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    replace: () => mask('private-key'),
  },
  {
    name: 'basic-auth',
    pattern: /\b(Authorization\s*:\s*Basic)\s+[A-Za-z0-9+/=]{8,}/gi,
    replace: (match) => `${match[1]} ${mask('basic-auth')}`,
  },
  {
    name: 'bearer-token',
    pattern: /\b(Bearer)\s+[A-Za-z0-9\-._~+/]{16,}={0,2}/g,
    replace: (match) => `${match[1]} ${mask('bearer-token')}`,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
    replace: () => mask('jwt'),
  },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, replace: () => mask('anthropic-key') },
  { name: 'openai-key', pattern: /\bsk-proj-[A-Za-z0-9_-]{16,}/g, replace: () => mask('openai-key') },
  { name: 'stripe-key', pattern: /\b[sr]k_live_[A-Za-z0-9]{8,}/g, replace: () => mask('stripe-key') },
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: () => mask('openai-key') },
  { name: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g, replace: () => mask('google-key') },
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}/g, replace: () => mask('aws-key') },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replace: () => mask('github-token') },
  { name: 'slack-token', pattern: /\bxox[abp]-[A-Za-z0-9-]{10,}/g, replace: () => mask('slack-token') },
  { name: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g, replace: () => mask('gitlab-token') },
  { name: 'huggingface-token', pattern: /\bhf_[A-Za-z0-9]{16,}/g, replace: () => mask('huggingface-token') },
  { name: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{16,}/g, replace: () => mask('npm-token') },
  {
    // Only the password is dropped: the scheme, user and host stay readable so
    // the transcript still shows which service was being talked to.
    name: 'connection-string',
    pattern: /\b([a-z][a-z0-9+.-]*):\/\/([^\s:/@]+):([^\s@/]{1,256})@/gi,
    replace: (match) => `${match[1]}://${match[2]}:${mask('credential')}@`,
  },
  {
    // Keeps the key name, drops the value. Values that are already a
    // placeholder are skipped so a vendor key is never counted twice.
    name: 'assignment',
    pattern:
      /\b(api[-_]?keys?|apikey|secret[-_]?key|client[-_]?secret|secret|password|passwd|pwd|access[-_]?token|auth[-_]?token)(\s*[:=]\s*)(["']?)([^\s"',;}]{3,})\3/gi,
    replace: (match) => {
      const value = match[4] ?? '';
      if (value.startsWith(REDACTION_PLACEHOLDER_PREFIX)) return null;
      return `${match[1]}${match[2]}${match[3]}${mask('secret')}${match[3]}`;
    },
  },
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    replace: () => mask('email'),
  },
  {
    // The lookbehind keeps dotted version numbers (`v1.2.3.4`, `1.2.3.4-rc1`)
    // intact: anything glued to a word character or another dot is not an address.
    name: 'ipv4',
    pattern: /(?<![\w.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\w.])/g,
    replace: (match) => (isIpv4(match[0]) ? mask('ip') : null),
  },
  {
    name: 'home-path',
    pattern: /(?:\/Users|\/home)\/[^/\s:"'<>|]+/g,
    replace: () => '~',
  },
  {
    name: 'home-path',
    pattern: /[A-Za-z]:\\Users\\[^\\\s:"'<>|]+/g,
    replace: () => '~',
  },
];

/**
 * Replace every credential-shaped run in `input` with a `[redacted:…]` marker.
 *
 * Returns the rewritten text and how many secrets were removed, so the UI can
 * tell the user what was stripped without ever showing the raw value.
 */
export function redactSecrets(input: string): RedactionResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { text: '', redactionCount: 0 };
  }

  let text = input;
  let redactionCount = 0;

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[];
      const match = groups as unknown as RegExpMatchArray;
      const replacement = rule.replace(match);
      if (replacement === null) return groups[0];
      redactionCount += 1;
      return replacement;
    });
  }

  return { text, redactionCount };
}

/** Redact a whole transcript, one `role: text` line per message. */
export function redactTranscript(messages: ReadonlyArray<{ role: string; text: string }>): RedactionResult {
  const joined = messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => `${message.role}: ${message.text}`)
    .join('\n\n');
  return redactSecrets(joined);
}
