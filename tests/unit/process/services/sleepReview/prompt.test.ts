import { describe, expect, it } from 'vitest';
import { buildReviewPrompt, extractFirstJsonObject, parseReviewAnswer } from '@process/services/sleepReview/prompt';
import { redactTranscript } from '@process/services/sleepReview/redaction';

describe('buildReviewPrompt', () => {
  it('never leaks a secret that redaction removed', () => {
    const raw = 'User: deploy with sk-abcdefghijklmnopqrstuvwxyz please';
    const prompt = buildReviewPrompt({
      targetPath: '/skills/deploy/SKILL.md',
      targetContent: '# Deploy',
      transcripts: [{ conversationId: 'c1', name: 'Deploy chat', redactedText: redactTranscript(raw).text }],
      heldOutPrompts: [],
    });

    expect(prompt).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(prompt).toContain('[REDACTED_API_KEY]');
  });

  it('includes the held-out prompts and their expectations', () => {
    const prompt = buildReviewPrompt({
      targetPath: '/skills/deploy/SKILL.md',
      targetContent: '# Deploy',
      transcripts: [],
      heldOutPrompts: [
        { id: 'h1', prompt: 'Deploy to staging', expected: 'asks for confirmation' },
        { id: 'h2', prompt: 'Roll back the release' },
      ],
    });

    expect(prompt).toContain('Deploy to staging (expected: asks for confirmation)');
    expect(prompt).toContain('Roll back the release');
  });

  it('carries the target path and content plus the six sleep-cycle stages', () => {
    const prompt = buildReviewPrompt({
      targetPath: '/skills/deploy/SKILL.md',
      targetContent: '# Deploy\nSteps here',
      transcripts: [],
      heldOutPrompts: [],
    });

    expect(prompt).toContain('/skills/deploy/SKILL.md');
    expect(prompt).toContain('Steps here');
    for (const stage of ['Harvest:', 'Mine:', 'Replay:', 'Consolidate:', 'Gate:', 'Stage:']) {
      expect(prompt).toContain(stage);
    }
  });
});

describe('extractFirstJsonObject', () => {
  it('pulls the object out of a chatty reply with a markdown fence', () => {
    const reply = 'Sure! Here is my proposal:\n```json\n{"rationale":"a","edit":{"type":"add"}}\n```\nHope that helps.';
    expect(extractFirstJsonObject(reply)).toBe('{"rationale":"a","edit":{"type":"add"}}');
  });

  it('handles nested objects and braces inside strings', () => {
    const reply = 'text {"a":{"b":"}"},"c":1} trailing';
    expect(extractFirstJsonObject(reply)).toBe('{"a":{"b":"}"},"c":1}');
  });

  it('returns undefined when there is no balanced object', () => {
    expect(extractFirstJsonObject('no json here')).toBeUndefined();
    expect(extractFirstJsonObject('{"unclosed": 1')).toBeUndefined();
  });
});

describe('parseReviewAnswer', () => {
  it('normalizes a valid answer', () => {
    const reply = `Here you go:
{
  "rationale": "the skill never mentions confirmation",
  "edit": { "type": "add", "anchor": "## Safety", "after": "Always confirm." },
  "heldOutChecks": ["Deploy to staging", 42],
  "risk": "slightly longer prompt",
  "rollback": "delete the added line"
}`;
    const { answer, error } = parseReviewAnswer(reply);

    expect(error).toBeUndefined();
    expect(answer?.edit).toEqual({ type: 'add', anchor: '## Safety', before: undefined, after: 'Always confirm.' });
    expect(answer?.heldOutChecks).toEqual(['Deploy to staging']);
    expect(answer?.risk).toBe('slightly longer prompt');
  });

  it('rejects a reply with no JSON object', () => {
    const { answer, error } = parseReviewAnswer('I refuse.');
    expect(answer).toBeUndefined();
    expect(error).toContain('no JSON object');
  });

  it('rejects an unsupported edit type', () => {
    const { answer, error } = parseReviewAnswer('{"edit":{"type":"rewrite"}}');
    expect(answer).toBeUndefined();
    expect(error).toContain('unsupported edit type');
  });
});
