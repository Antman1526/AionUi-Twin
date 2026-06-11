# AionUi Twin Technology Audit

## Languages and Runtimes

- TypeScript: primary language for desktop main/preload/renderer, server, scripts, and mobile source.
- JavaScript/Node.js: Electron runtime, scripts, CommonJS extension loading, build tools.
- Bun: package manager/test runner/script runner; lockfile owner.
- SQL/SQLite: persistent storage schema, migrations, queries.
- HTML/CSS: renderer entry documents, static QR login page, CSS themes.
- TSX/JSX: React and React Native UI.

## Desktop and Web Frameworks

- Electron: native desktop shell and IPC runtime.
- Electron Vite: builds Electron main/preload/renderer entries.
- React/React DOM: desktop renderer UI.
- React Router DOM: renderer navigation.
- Arco Design: primary desktop UI component library.
- UnoCSS: utility CSS and theme-token styling.
- Express: WebUI/API server.
- ws: WebSocket server for WebUI/mobile live traffic.
- Expo / React Native / Expo Router: companion mobile app.

## Databases and Storage

- SQLite via better-sqlite3: users, conversations, messages, teams, mailbox, tasks, channels, providers/settings through repository layers.
- Async Storage and Expo Secure Store: mobile local state and secure mobile storage.
- ProcessConfig/initStorage: desktop runtime config/data/cache directories.

## AI, Agent, and Protocol Libraries

- OpenAI SDK: OpenAI-compatible provider calls.
- Anthropic SDK: Claude provider calls.
- Google GenAI SDK: Gemini/Vertex provider calls.
- AWS Bedrock SDK: Bedrock model integration.
- Agent Client Protocol SDK: ACP agent support.
- Model Context Protocol SDK: MCP services and built-in MCP servers.
- Office AI Aion CLI/core/platform packages: Aion CLI and office/assistant workflows.
- llama.cpp `llama-server` (external executable, not npm): serves local GGUF files through an OpenAI-compatible HTTP API for managed local model chats.
- Microsoft SkillOpt (external upstream project, not bundled as a runtime dependency): informs the mandatory built-in `skillopt-sleep` AionUi skill for validation-gated skill and memory improvement workflows.

## UI, Rendering, and Editing

- Icon Park React: icon system.
- Monaco Editor and CodeMirror/UIW CodeMirror: code editing/config editing.
- React Markdown, streamdown, remark/rehype plugins: markdown rendering.
- KaTeX: math rendering.
- Mermaid: diagram rendering.
- React Syntax Highlighter: code highlighting.
- React Virtuoso: virtualized lists.
- Floating UI and dnd-kit: overlays and drag/drop.

## Backend Middleware and Security

- jsonwebtoken: JWT sessions.
- bcryptjs: password hashing.
- express-rate-limit: brute-force/API throttling.
- cookie and cookie-parser: cookie parsing/serialization.
- tiny-csrf: CSRF protection support.
- cors: WebUI CORS.
- multer: file and audio uploads.
- zod: schema validation utilities.

## Documents, Files, and Media

- docx, mammoth, officeparser, pptx2json, xlsx-republish: Office/document parsing and generation.
- sharp: image processing.
- html-to-text, turndown, turndown-plugin-gfm: HTML/text/markdown conversion.
- diff and diff2html: diff generation/rendering.
- web-tree-sitter and tree-sitter-bash: syntax parsing.
- smol-toml, jsonrepair, strip-json-comments: config parsing/repair.

## Remote Channel Integrations

- grammy and transformer-throttler: Telegram bot integration.
- dingtalk-stream: DingTalk stream integration.
- @wecom/aibot-node-sdk: WeCom bot integration.
- @larksuiteoapi/node-sdk: Lark/Feishu-style integration.
- qrcode-terminal and qrcode.react: QR login display and UI QR codes.

## Build, Quality, and Testing

- electron-builder: installers and app packages.
- Vite: renderer/server build engine.
- vite-plugin-static-copy: copies runtime skills/assistants/assets.
- Sentry Electron and Sentry Vite plugin: error monitoring/source maps.
- Vitest: unit/integration/regression tests.
- Playwright: Electron E2E tests.
- Jest/Jest Expo: mobile tests.
- Testing Library: React and React Native component tests.
- oxlint/oxfmt/prettier config: lint/format.
- Husky/lint-staged/prek: local hooks and PR checks.

## Local AI Runtime Assets

- GGUF files: user-provided local model binaries discovered from configured folders.
- `AIONUI_MODEL_DIRS`: optional path-delimited environment override for model scanning.
- `localModel.runtimeOptions`: ProcessConfig storage for context, GPU layers, readiness timeout, and reasoning behavior.
- Managed provider id prefix `local-llama-cpp-`: runtime marker used to replace stale managed providers without touching user providers.

## Deployment and Infrastructure

- GitHub Actions: CI, PR checks, release, project automation, artifacts.
- Dockerfile: server/container deployment support.
- Homebrew formula template: macOS distribution path.
- electron-updater: desktop auto-update support.
- electron-builder NSIS/DMG/DEB targets: installer distribution.

## Areas for Review

- Which dependencies are runtime-critical but only implicitly included in electron-builder packaging?
- Which AI provider SDKs can be abstracted behind a generated provider contract?
- Which remote-channel integrations need credential rotation and webhook/event replay protection?
