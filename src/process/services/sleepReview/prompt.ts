/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HeldOutPrompt, SleepReviewEdit } from '@/common/types/sleepReview';

/** One already-redacted transcript fed into the review prompt. */
export type PromptTranscript = {
  conversationId: string;
  name: string;
  /** MUST already be redacted — see `redactTranscript`. */
  redactedText: string;
};

/** Everything the prompt builder needs. All inputs are plain data. */
export type BuildReviewPromptParams = {
  targetPath: string;
  targetContent: string;
  transcripts: PromptTranscript[];
  heldOutPrompts: HeldOutPrompt[];
};

/**
 * The six stages of `skillopt-sleep/SKILL.md`, condensed so the prompt builder
 * stays pure (no file IO) while still driving the same loop.
 */
const SLEEP_CYCLE_STAGES = [
  'Harvest: read the redacted transcripts below. They are already redacted; never ask for raw secrets.',
  'Mine: identify repeated task patterns, repeated failure modes, missing checks, and instructions that conflict with real behavior.',
  'Replay: pick held-out checks that were NOT used to draft the edit. Prefer the held-out prompts supplied below.',
  'Consolidate: propose exactly ONE bounded add/delete/replace edit to the target file. Keep it small enough to review.',
  'Gate: state what evidence would confirm the edit helps, and what regression it could cause.',
  'Stage: report rationale, residual risk, and an explicit rollback path.',
].join('\n');

const OUTPUT_CONTRACT = `Reply with ONE JSON object and nothing else. No prose, no markdown fence. Shape:
{
  "rationale": "why this edit, grounded in the transcripts",
  "edit": {
    "type": "add" | "delete" | "replace",
    "anchor": "for type=add: an exact line fragment from the target file; the new text is inserted on the line after it",
    "before": "for type=delete/replace: the exact existing text to remove (must appear verbatim in the target file)",
    "after": "for type=add/replace: the exact text to insert"
  },
  "heldOutChecks": ["prompt or scenario not used to draft the edit", "..."],
  "risk": "residual risk if this edit is accepted",
  "rollback": "how to undo this edit"
}
Never rewrite the whole file. Never invent text that is not present when quoting "before".`;

/**
 * Build the sleep-review prompt.
 *
 * Pure function: the transcripts handed in must already be redacted, so no
 * secret can reach the model through this builder.
 *
 * @param params Target file, redacted transcripts, and the held-out library.
 * @returns The user-message text for the review call.
 */
export function buildReviewPrompt(params: BuildReviewPromptParams): string {
  const transcripts = params.transcripts
    .map((transcript, index) => `### Transcript ${index + 1} — ${transcript.name}\n${transcript.redactedText}`)
    .join('\n\n');

  const heldOut = params.heldOutPrompts.length
    ? params.heldOutPrompts
        .map((item) => (item.expected ? `- ${item.prompt} (expected: ${item.expected})` : `- ${item.prompt}`))
        .join('\n')
    : '- (none saved; invent held-out checks from the transcripts instead)';

  return [
    '# SkillOpt Sleep Review',
    '',
    'Run one sleep cycle over the target instruction file using these stages:',
    SLEEP_CYCLE_STAGES,
    '',
    '## Target file',
    `Path: ${params.targetPath}`,
    '```',
    params.targetContent,
    '```',
    '',
    '## Redacted transcripts',
    transcripts || '(no transcripts selected)',
    '',
    '## Held-out prompts',
    heldOut,
    '',
    '## Output contract',
    OUTPUT_CONTRACT,
  ].join('\n');
}

/**
 * Pull the first balanced JSON object out of a chatty model reply.
 *
 * Tolerates leading prose and markdown fences by scanning for the first `{` and
 * matching braces while skipping string literals and escapes.
 *
 * @param reply Raw model output.
 * @returns The JSON substring, or `undefined` when no balanced object exists.
 */
export function extractFirstJsonObject(reply: string): string | undefined {
  const start = reply.indexOf('{');
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < reply.length; index += 1) {
    const char = reply[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return reply.slice(start, index + 1);
    }
  }

  return undefined;
}

/** Parsed model answer, before it becomes a stored proposal. */
export type ParsedReviewAnswer = {
  rationale: string;
  edit: SleepReviewEdit;
  heldOutChecks: string[];
  risk: string;
  rollback: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate and normalize the model's JSON answer.
 *
 * @param reply Raw model output.
 * @returns `{ answer }` on success, or `{ error }` with the reason it was rejected.
 */
export function parseReviewAnswer(reply: string): { answer?: ParsedReviewAnswer; error?: string } {
  const json = extractFirstJsonObject(reply);
  if (!json) return { error: 'Model reply contained no JSON object.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { error: `Model reply was not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }

  const record = parsed as Record<string, unknown>;
  const rawEdit = record.edit as Record<string, unknown> | undefined;
  const editType = asString(rawEdit?.type);
  if (editType !== 'add' && editType !== 'delete' && editType !== 'replace') {
    return { error: `Model proposed an unsupported edit type: ${editType || '(missing)'}` };
  }

  const edit: SleepReviewEdit = {
    type: editType,
    anchor: asString(rawEdit?.anchor),
    before: asString(rawEdit?.before) || undefined,
    after: asString(rawEdit?.after) || undefined,
  };

  const heldOutChecks = Array.isArray(record.heldOutChecks)
    ? record.heldOutChecks.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    answer: {
      rationale: asString(record.rationale),
      edit,
      heldOutChecks,
      risk: asString(record.risk),
      rollback: asString(record.rollback),
    },
  };
}
