# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Test Stack

Desktop uses Vitest 4 with node and jsdom projects, Testing Library for React, Playwright for Electron E2E, Bun tests for some native/benchmark flows, and V8 coverage. Mobile uses Jest Expo and React Native Testing Library.

Vitest includes unit, integration, regression, and DOM tests. Playwright runs under `tests/e2e`, one worker, shared Electron instance, retry on CI, HTML reports, traces/videos on retry/failure.

Required checks:

```bash
bun run lint
bun run format:check
bunx tsc --noEmit
bun run i18n:types
node scripts/check-i18n.js
bun run test
bun run test:e2e
```

SkillOpt-style improvements require a separate validation gate before adoption.
For a proposed skill or memory edit, record the baseline behavior, the candidate
edit, and held-out checks that were not used to draft the change. Accept the
candidate only if those checks improve or a verified defect is fixed without a
regression. The bundled `skillopt-sleep` skill contains the operational template.

High-value tests: DB corruption vs native ABI failures, auth constant-time paths, token logout, upload workspace mismatch, extension traversal, task cache/idle kill, New API URL normalization, renderer auth readiness, build static copy/asarUnpack behavior.

## Local Model Test Matrix

| Layer | Test |
| ----- | ---- |
| Unit | `buildLlamaServerArgs` includes `-c`, `-ngl`, and optional `--reasoning off/on`. |
| Unit | Runtime options clamp invalid context/timeout/GPU values. |
| Unit | Managed provider replacement preserves user-defined providers. |
| Unit | No-key provider support is limited to local/loopback base URLs. |
| Bridge | `localModel.start` stops partial launches on error. |
| Renderer DOM | Local GGUF settings saves directories and runtime options. |
| E2E | Load `Qwen3.5-4B-Q4_K_M`, send `7+5`, assert UI and SQLite contain `12`. |
| Manual | Test each discovered GGUF model with a short deterministic arithmetic prompt. |

## Areas for Review

- Raise coverage thresholds incrementally.
- Add IPC contract tests for bridge names/payloads.
- Add WebUI route tests against temp SQLite state.
- Add a deterministic local model smoke harness that times out safely and reports model-by-model pass/fail.
