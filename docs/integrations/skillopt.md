# Microsoft SkillOpt Integration

## Purpose

AionUi Twin integrates Microsoft SkillOpt at the workflow layer through the bundled `skillopt-sleep` skill. The goal is to improve agent reliability by applying SkillOpt's core idea to AionUi skills and project memory: treat instruction files as trainable artifacts, update them with small bounded edits, and accept changes only after a validation gate.

Upstream: https://github.com/microsoft/SkillOpt  
License: MIT for upstream SkillOpt. AionUi Twin remains governed by this repository's license.

## Integration Shape

The integration is intentionally additive and does not vendor the upstream Python package into the Electron bundle.

Implemented artifact:

```text
src/process/resources/skills/skillopt-sleep/SKILL.md
```

At build time, `electron.vite.config.ts` copies `src/process/resources/skills/*` into packaged resources. During app startup, `src/process/utils/initStorage.ts` copies bundled skills into the user's built-in skills directory. `src/process/task/AcpSkillManager.ts` then discovers optional skills when an assistant enables them through `enabledSkills`.

This means `skillopt-sleep` is available like other bundled optional skills, but it does not add prompt overhead to every conversation by living under `_builtin`.

## Why Not Bundle the Full Python Runtime Yet

SkillOpt's Python runtime is useful for offline experiments, but bundling it directly into AionUi would add several product obligations:

- Python 3.10+ runtime discovery or embedding.
- Dependency installation and update policy for the SkillOpt package and its optional WebUI stack.
- API-key and transcript privacy controls for optimizer runs.
- Cost controls for replaying historical sessions through external models.
- A UI for staging, reviewing, accepting, and rolling back generated skill edits.
- E2E test coverage across macOS, Windows, and Linux packaging.

The current implementation captures the practical benefit inside AionUi immediately: agents can run a validation-gated improvement cycle on local project skills and docs using existing app mechanics.

## Runtime Workflow

When the skill is enabled, an agent should run this loop:

1. Harvest relevant session summaries, failed outputs, successful outputs, tests, user corrections, and project notes.
2. Mine recurring task patterns and failure modes.
3. Create held-out validation checks that were not used to draft the edit.
4. Propose one bounded add/delete/replace edit to a skill, README, or memory artifact.
5. Run the held-out checks or report why they cannot be run.
6. Stage the proposal with baseline behavior, evidence, risk, and rollback instructions.

The skill explicitly rejects unvalidated broad rewrites because those tend to overfit one bad conversation and degrade future behavior.

## Optional Upstream Usage

Developers who want the upstream SkillOpt-Sleep experiment can run it outside AionUi:

```bash
git clone https://github.com/microsoft/SkillOpt.git
cd SkillOpt
python3.10 -m venv .venv
. .venv/bin/activate
pip install -e .
python -m skillopt_sleep.experiments.run_experiment --persona researcher --assert-improves
```

The upstream repository also includes a Codex plugin installer:

```bash
cd SkillOpt
bash plugins/codex/install.sh
```

Do not run private transcripts, project files, or API-backed optimizer loops through upstream tools without explicit user approval.

## Future Product Enhancements

The next deeper integration should be a native AionUi "Sleep Review" feature:

- Local transcript selector with redaction preview.
- Skill proposal diff UI.
- Held-out prompt/test library per project.
- Local-only mode using installed GGUF models through the managed llama.cpp provider.
- Optional cloud optimizer mode with explicit API cost and data disclosure.
- Accept/reject history with rollback.
- Scheduled sleep cycles that stage changes but never apply them automatically.

## Areas for Review

- Should `skillopt-sleep` become a default skill for the Cowork assistant, or remain opt-in for lower prompt overhead?
- Should AionUi store held-out validation prompts in the project workspace or in application config?
- Should sleep-cycle replay use local GGUF models by default and cloud models only after explicit opt-in?
- What minimum validation score or check count should be required before a generated skill edit can be accepted?
