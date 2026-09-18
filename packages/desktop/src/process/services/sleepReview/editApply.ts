/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { SleepReviewEdit } from '@/common/types/sleepReview';

/** SHA-256 of a file's text, used as the drift guard between staging and accept. */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Apply one bounded edit to `content` and return the new text.
 *
 * Every failure mode throws rather than silently producing a no-op edit: a
 * proposal whose anchor has since moved must be rejected, not half-applied.
 *
 * - `add` inserts `edit.after` on the line following the first line that
 *   contains `edit.anchor`.
 * - `delete` removes the first occurrence of `edit.before`.
 * - `replace` swaps the first occurrence of `edit.before` for `edit.after`.
 */
export function applyEdit(content: string, edit: SleepReviewEdit): string {
  switch (edit.type) {
    case 'add': {
      const anchor = edit.anchor ?? '';
      const addition = edit.after ?? '';
      if (!anchor.trim()) throw new Error('An "add" edit needs an anchor');
      if (!addition) throw new Error('An "add" edit needs text to insert');

      const lines = content.split('\n');
      const index = lines.findIndex((line) => line.includes(anchor));
      if (index < 0) throw new Error(`Anchor not found in the target file: ${anchor}`);

      lines.splice(index + 1, 0, addition);
      return lines.join('\n');
    }
    case 'delete': {
      const before = edit.before ?? '';
      if (!before) throw new Error('A "delete" edit needs the text to remove');
      const index = content.indexOf(before);
      if (index < 0) throw new Error('Text to delete was not found in the target file');
      return content.slice(0, index) + content.slice(index + before.length);
    }
    case 'replace': {
      const before = edit.before ?? '';
      const after = edit.after ?? '';
      if (!before) throw new Error('A "replace" edit needs the text to replace');
      const index = content.indexOf(before);
      if (index < 0) throw new Error('Text to replace was not found in the target file');
      return content.slice(0, index) + after + content.slice(index + before.length);
    }
    default: {
      const unknownType: string = (edit as { type: string }).type;
      throw new Error(`Unsupported edit type: ${unknownType}`);
    }
  }
}
