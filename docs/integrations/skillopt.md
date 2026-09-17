# Microsoft SkillOpt Integration

## Purpose

AionUi Twin integrates Microsoft SkillOpt at the workflow layer through the mandatory built-in `skillopt-sleep` skill. The goal is to improve agent reliability by applying SkillOpt's core idea to AionUi skills and project memory: treat instruction files as trainable artifacts, update them with small bounded edits, and accept changes only after a validation gate.

Upstream: https://github.com/microsoft/SkillOpt  
License: MIT for upstream SkillOpt. AionUi Twin remains governed by this repository's license.

## Integration Shape

The integration is intentionally additive and does not vendor the upstream Python package into the Electron bundle.

Implemented artifact:

```text
src/process/resources/skills/_builtin/skillopt-sleep/SKILL.md
```

At build time, `electron.vite.config.ts` copies `src/process/resources/skills/*` into packaged resources. During app startup, `src/process/utils/initStorage.ts` copies bundled skills into the user's built-in skills directory. `src/process/task/AcpSkillManager.ts` discovers `_builtin` skills through `discoverAutoSkills()`, so `skillopt-sleep` is available to every ACP agent without per-assistant `enabledSkills` configuration.

This makes `skillopt-sleep` mandatory at the skill-index layer. Agents still load the full body on demand through the existing `[LOAD_SKILL: skillopt-sleep]` flow, which keeps the always-present index small while making the workflow impossible to miss.

## Why Not Bundle the Full Python Runtime Yet

SkillOpt's Python runtime is useful for offline experiments, but bundling it directly into AionUi would add several product obligations:

- Python 3.10+ runtime discovery or embedding.
- Dependency installation and update policy for the SkillOpt package and its WebUI stack.
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

## Native Sleep Review (implemented)

The deeper integration now exists as a first-class page at `/sleep-review`
(sider entry "Sleep Review", route registered in
`src/renderer/components/layout/Router.tsx`). It runs entirely inside AionUi:

- **Transcript selector with redaction preview.** `sleepReview.listConversations`
  lists stored conversations; `sleepReview.previewTranscript` returns the
  **redacted** transcript plus a redaction count. Raw transcript text never
  crosses the IPC boundary — `src/process/services/sleepReview/redaction.ts`
  strips OpenAI/Anthropic/AWS/GitHub/Slack keys, bearer tokens, JWTs, emails,
  IPv4 addresses, and collapses absolute home paths to `~`.
- **Target selection.** `sleepReview.listTargets` lists user and bundled
  `SKILL.md` files (excluding the app-managed `_builtin` set) plus workspace
  memory files (`AGENTS.md`, `CLAUDE.md`, `README.md`, `.aionui/memory.md`).
- **Held-out prompt/test library per project.** Stored at
  `<workspace>/.aionui/held-out-prompts.json` with a global fallback at
  `<userData>/sleep-review/held-out-prompts.json`. Edited from the
  "Held-out prompts" tab.
- **Local-only mode.** A switch filters the provider list to providers that run
  on this machine: the managed llama.cpp provider (`local-llama-cpp-*`), Ollama
  and LM Studio platforms, or a loopback base URL. A run with `localOnly` set
  refuses any other provider.
- **Skill proposal diff UI.** A run asks the model for one bounded
  add/delete/replace edit as a single JSON object. The proposal is staged with
  the SHA-256 of the target file and shown as a unified diff
  (`diff.createTwoFilesPatch`) computed from the current file content with the
  edit applied in memory.
- **Accept/reject history with rollback.** Accepting re-hashes the target: if it
  drifted from `baselineSha256` the proposal is marked `failed` and nothing is
  written. Otherwise the file is copied to
  `<userData>/sleep-review/backups/<proposalId>/<basename>` before the edit
  lands, and "Roll back" restores that backup. Proposals live in
  `<userData>/sleep-review/proposals.json` (atomic write: temp file + rename).
- **Optional "Run checks".** `sleepReview.runHeldOut` runs each of a proposal's
  held-out checks twice — once with the pre-edit target as system context, once
  with the post-edit target — and shows both outputs side by side. There is no
  automatic scoring; a human compares the columns.

Model calls reuse the app's existing rotating client stack
(`ClientFactory.createRotatingClient` → `createChatCompletion`); no new HTTP
client was added.

### Still open

- Cloud optimizer mode with explicit API cost and data disclosure.
- Scheduled sleep cycles that stage changes but never apply them automatically.

## Areas for Review

- Should the mandatory `skillopt-sleep` index entry be made shorter if prompt overhead becomes measurable?
- Should AionUi store held-out validation prompts in the project workspace or in application config?
- Should sleep-cycle replay use local GGUF models by default and cloud models only after explicit opt-in?
- What minimum validation score or check count should be required before a generated skill edit can be accepted?
