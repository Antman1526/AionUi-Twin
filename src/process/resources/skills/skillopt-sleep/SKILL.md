---
name: skillopt-sleep
description: Use Microsoft SkillOpt-inspired sleep cycles to improve agent skills and long-term project memory with validation-gated, reviewable edits. Use when optimizing AionUi skills, recurring workflows, agent instructions, or repeated task failures.
---

# SkillOpt Sleep for AionUi

This skill adapts the workflow from Microsoft SkillOpt and SkillOpt-Sleep to AionUi's bundled skill system. Treat skill files, agent instructions, and project memory as trainable text artifacts, but only accept changes after evidence shows they improve held-out tasks.

Source project: https://github.com/microsoft/SkillOpt

## Core Rule

Do not blindly rewrite a skill because a single session went poorly. Propose small, reviewable edits, validate them against examples that were not used to create the edit, and reject changes that do not improve the outcome.

## When To Use

Use this skill when the user asks to:

- Improve AionUi skills, agent behavior, prompts, or project memory.
- Diagnose repeated agent failures across similar tasks.
- Convert recurring user workflows into reusable skills.
- Run a "sleep", reflection, retrospective, or long-term memory consolidation pass.
- Evaluate whether an instruction change made the agent more reliable.

Do not use this skill for one-off questions where no reusable workflow or agent behavior is being improved.

## Sleep Cycle

One cycle has six stages:

1. **Harvest**: collect the relevant session summaries, failed outputs, successful outputs, tests, issue notes, and user corrections. Redact secrets and avoid including private transcript content outside the local machine unless the user explicitly approves it.
2. **Mine**: identify repeated task patterns, repeated failure modes, missing checks, unclear triggers, and instructions that conflict with real project behavior.
3. **Replay**: create a small held-out test set. Include at least one success case, one failure case, and one edge case. Prefer executable project checks when possible.
4. **Consolidate**: propose bounded add/delete/replace edits to one skill, README section, or memory file at a time. Keep the edit small enough to review.
5. **Gate**: run the held-out tests or prompt checks against the proposed text. Accept only if the proposed version is measurably better or clearly fixes a verified defect without regression.
6. **Stage**: summarize the change, evidence, residual risk, and rollback path for the user before adoption when modifying shared skills or project guidance.

## Validation Gate

Before recommending adoption, report:

- Baseline behavior: what failed or was missing before the proposed edit.
- Candidate change: exact file or artifact to update.
- Held-out checks: prompts, tests, or manual scenarios not used to draft the change.
- Result: pass/fail evidence and any regression found.
- Decision: accept, reject, or revise.

If validation is weak, say so. A useful rejection is better than storing an overfit instruction.

## AionUi Implementation Guidance

AionUi skills are packaged under `src/process/resources/skills/<skill-name>/SKILL.md` and copied into the user's built-in skills directory at runtime. Prefer this path for reusable agent behavior because it works with the existing Skill Hub and assistant `enabledSkills` flow.

For large or high-risk guidance:

- Keep it as an optional skill instead of auto-injecting it from `_builtin`.
- Use frontmatter with a concise `name` and high-signal `description`.
- Keep tool installation commands optional and clearly separate from the default workflow.
- Add project documentation under `docs/` when future maintainers need architecture context.
- Avoid bundling external Python packages into the Electron app unless the app has an explicit runtime bridge, updater policy, and test coverage for that dependency.

## Optional Upstream Runtime

The AionUi skill can be used without installing the upstream Python package. If the user wants to run Microsoft's deterministic SkillOpt-Sleep experiment outside AionUi, use an isolated Python environment:

```bash
git clone https://github.com/microsoft/SkillOpt.git
cd SkillOpt
python3.10 -m venv .venv
. .venv/bin/activate
pip install -e .
python -m skillopt_sleep.experiments.run_experiment --persona researcher --assert-improves
```

For Codex-style `/sleep` integration, the upstream repository includes a Codex plugin installer:

```bash
cd SkillOpt
bash plugins/codex/install.sh
```

Only run upstream optimizers against private transcripts, API-backed models, or cloud services after the user approves the data and cost implications.

## Safety

- Redact `.env` values, tokens, passwords, private keys, provider API keys, OAuth secrets, and personal data.
- Do not upload session transcripts or project files to cloud optimizers without explicit user approval.
- Do not overwrite an existing working skill with an unvalidated candidate.
- Preserve user-authored guidance unless it conflicts with verified behavior.
- Keep candidate edits rollback-friendly and explain how to undo them.

## Output Template

When running a SkillOpt-style review, use this structure:

```markdown
## SkillOpt Sleep Review

Baseline:
- ...

Recurring Pattern:
- ...

Candidate Change:
- File: ...
- Edit type: add/delete/replace
- Rationale: ...

Validation Gate:
- Held-out checks: ...
- Result: ...

Decision:
- Accept / reject / revise

Next Step:
- ...
```
