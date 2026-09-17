/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { redactTranscript, type RedactionResult } from './redaction';

/** Hard cap so a very long conversation cannot blow up the review prompt. */
const MAX_TRANSCRIPT_CHARS = 20_000;

function readTextContent(message: TMessage): string | undefined {
  const content = message.content as { content?: unknown } | undefined;
  const value = content?.content;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Flatten persisted messages into a plain `Role: text` transcript.
 *
 * Only messages carrying plain string content are included — tool payloads and
 * structured results are skipped because they add noise without adding signal
 * for instruction-file review.
 *
 * @param messages Persisted conversation messages, oldest first.
 * @returns Raw (unredacted) transcript text. Callers must redact before use.
 */
export function buildRawTranscript(messages: TMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = readTextContent(message);
    if (!text) continue;
    const role = message.position === 'right' ? 'User' : 'Assistant';
    lines.push(`${role}: ${text}`);
  }
  const joined = lines.join('\n\n');
  return joined.length > MAX_TRANSCRIPT_CHARS ? `${joined.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[...truncated]` : joined;
}

/**
 * Build a redacted transcript for one conversation.
 *
 * @param messages Persisted conversation messages, oldest first.
 * @returns Redacted transcript text and the number of redactions applied.
 */
export function buildRedactedTranscript(messages: TMessage[]): RedactionResult {
  return redactTranscript(buildRawTranscript(messages));
}
