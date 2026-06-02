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

High-value tests: DB corruption vs native ABI failures, auth constant-time paths, token logout, upload workspace mismatch, extension traversal, task cache/idle kill, New API URL normalization, renderer auth readiness, build static copy/asarUnpack behavior.

## Areas for Review

- Raise coverage thresholds incrementally.
- Add IPC contract tests for bridge names/payloads.
- Add WebUI route tests against temp SQLite state.
