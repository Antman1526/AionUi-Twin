# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Configuration Files

`package.json`, `mobile/package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `vitest.config.ts`, `playwright.config.ts`, `uno.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`, `.prettierrc.json`, `Dockerfile`, `justfile`, `Makefile`, and `.github/workflows/*.yml` define the development, build, test, release, and deployment behavior.

Important env vars: `NODE_ENV`, `AIONUI_MULTI_INSTANCE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DSN`, `ALLOW_REMOTE`, `DISPLAY`, `PREBUILDS_ONLY`, `ACP_PERF`, `PERF_MONITOR`.

Vite main entries include `src/index.ts`, `src/process/worker/gemini.ts`, and extension lifecycle runner. Production static copy moves built-in skills, assistants, and logos into build output. Electron Builder includes native modules and bundled resources while excluding unsigned/problematic binaries.

## Areas for Review

- Create a complete `.env.example` from all runtime env vars.
- Validate ProcessConfig values with Zod schemas.
- Add tests for packaged file inclusion rules.
