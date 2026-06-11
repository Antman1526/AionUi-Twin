# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Required Environment

Use Bun as the primary package runner because the repository has `bun.lock` and scripts assume Bun for tests, server launch, benchmarks, and mobile workflows. Node.js is still required for Electron, Vite, electron-builder, and build scripts. TypeScript is the implementation language for desktop/server/mobile source.

## Setup

```bash
cd /Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main
bun install
bun run i18n:types
bunx tsc --noEmit
bun run test
bun run start
```

Mobile setup:

```bash
cd /Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main/mobile
bun install
bun run start
```

## Core Runtime Dependencies

- Electron `^37.10.3`: native desktop shell.
- React `^19.1.0` and React DOM `^19.1.0`: renderer UI.
- Electron Vite `^5.0.0`: builds main, preload, renderer, pet windows, workers, and lifecycle runner.
- Electron Builder `^26.6.0`: macOS DMG/ZIP, Windows NSIS/ZIP, Linux DEB.
- Better SQLite3 `^12.4.1`: native SQLite database driver.
- Express `^5.1.0`, `ws`, `multer`, `cors`, `cookie-parser`, `express-rate-limit`: WebUI/API server.
- JWT + auth: `jsonwebtoken`, `bcryptjs`, `tiny-csrf`, `cookie`.
- UI: `@arco-design/web-react`, `@icon-park/react`, `unocss`, `react-router-dom`, `react-virtuoso`.
- Markdown/editor/rendering: `react-markdown`, `streamdown`, `remark-*`, `rehype-*`, `katex`, `mermaid`, `react-syntax-highlighter`, Monaco, CodeMirror, Tree-sitter.
- AI providers: `openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-bedrock`.
- Agent protocols: `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk`, `@office-ai/aioncli-core`, `@office-ai/platform`.
- Remote channels: `grammy`, `dingtalk-stream`, `@wecom/aibot-node-sdk`, `@larksuiteoapi/node-sdk`.
- Document/media: `docx`, `mammoth`, `officeparser`, `pptx2json`, `xlsx-republish`, `sharp`, `html-to-text`, `turndown`.

## Local Model Runtime Prerequisites

The app does not bundle llama.cpp. To recreate the local GGUF workflow install
`llama-server` separately and ensure it can be resolved by either `PATH`,
`/opt/homebrew/bin/llama-server`, or `/usr/local/bin/llama-server`.

```bash
brew install llama.cpp
which llama-server
llama-server --help | head
```

Configured model roots are stored in `localModel.directories`; default discovery
also checks common folders such as `~/AI_Models/GGUF`, `~/AI_Models`,
`~/Models/GGUF`, `~/Models`, `~/Desktop/AI_Models/GGUF`,
`~/Desktop/AI_Models`, Ollama/LM Studio caches, and llama.cpp caches when they
exist. For Antman's test machine, the primary root is:

```text
/Users/Antman/Desktop/AI_Models/GGUF
```

Per-model runtime options are stored under `localModel.runtimeOptions` and are
clamped by `localModelBridge.ts` before reaching process spawn:

```ts
const MIN_CONTEXT_SIZE = 512;
const MAX_CONTEXT_SIZE = 262_144;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 900_000;
```

## Dev/Test Dependencies

- `oxlint 1.56.0`, `oxfmt ^0.41.0`, TypeScript `^5.8.3`.
- `vitest ^4.0.18`, `jsdom`, Testing Library, Playwright.
- `husky`, `lint-staged`, `@j178/prek` for PR parity checks.
- `tsx`, `ts-node`, `esbuild`, `vite-plugin-static-copy`, Sentry Vite plugin.

## Mobile Dependencies

The mobile app uses Expo `~55.0.4`, Expo Router `~55.0.3`, React Native `0.83.2`, React `19.2.0`, React Navigation, Async Storage, Secure Store, Axios, FlashList, Reanimated, SVG, and Jest Expo.

## Areas for Review

- Should the README standardize on Bun-only commands except where Node is mandatory?
- Are Electron native prebuilds and ABI assumptions documented enough for Windows/macOS/Linux rebuilds?
- Should mobile and desktop React/i18next versions be aligned or intentionally isolated?
- Should the app offer an in-app llama.cpp install check with platform-specific install commands?
