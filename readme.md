# AionUi Twin

AionUi Twin is an Electron, React, and TypeScript desktop application that turns command-line and API-backed AI agents into a modern chat, workspace, team, automation, WebUI, and extension platform. It includes a local desktop app, an optional browser-accessible WebUI server, remote messaging channels, built-in assistants/skills, and a companion Expo mobile app.

This repository is a source-grounded twin/documentation copy intended for reconstruction, audit, optimization, and future development.

## Core Capabilities

- Desktop AI chat interface for ACP agents, Aion CLI, Gemini, Nanobot, and remote agents.
- Persistent conversations, messages, users, teams, mailbox entries, tasks, providers, channels, and settings in SQLite.
- WebUI server with JWT cookie auth, QR login, file uploads, speech-to-text upload, WebSocket traffic, extension routes, and static renderer serving.
- Team mode for multi-agent collaboration with shared workspaces, mailbox routing, and task tracking.
- Extension registry and channel plugins for remote integrations such as Telegram, DingTalk, Weixin, and WeCom.
- Built-in skills and assistants packaged with the app.
- Expo/React Native mobile app under `mobile/`.

## Tech Stack

- Desktop: Electron 37, electron-vite, electron-builder.
- Frontend: React 19, Arco Design, UnoCSS, React Router, i18next.
- Backend/runtime: Node.js, Bun, Express 5, WebSocket, SQLite via better-sqlite3.
- AI integrations: OpenAI-compatible APIs, Anthropic, Gemini/Vertex, AWS Bedrock, ACP, MCP, Aion CLI.
- Testing: Vitest, Playwright, Testing Library, Jest Expo.
- Mobile: Expo 55, React Native 0.83, Expo Router.

## Repository Layout

```text
src/common      shared config, types, adapters, provider clients, utilities
src/preload     Electron contextBridge entry points
src/process     Electron main process, database, webserver, agents, channels, teams, IPC bridges
src/renderer    React renderer app, pages, components, hooks, styles, PWA support
mobile          Expo companion app
docs            architecture notes, guides, PRDs, specs, generated Twin docs
scripts         build, release, benchmark, i18n, and automation scripts
resources       app icons, bundled runtimes, installer files, README media
public          static renderer/PWA/pet assets
tests           unit, integration, regression, E2E, and benchmark tests
```

## Quick Start

```bash
cd /Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main
bun install
bun run i18n:types
bunx tsc --noEmit
bun run test
bun run start
```

WebUI development:

```bash
bun run webui
bun run webui:remote
```

Mobile development:

```bash
cd mobile
bun install
bun run start
```

## Build Commands

```bash
bun run package        # electron-vite build
bun run dist           # electron-builder via scripts/build-with-builder.js
bun run dist:mac
bun run dist:win
bun run dist:linux
bun run build:renderer:web
bun run build:server
```

## Quality Checks

```bash
bun run lint
bun run format:check
bunx tsc --noEmit
bun run i18n:types
node scripts/check-i18n.js
bun run test
bun run test:e2e
```

## Documentation

The requested reconstruction and audit set lives in [`docs/twin/`](docs/twin/README.md):

- 15 detailed technical reconstruction documents.
- 3-page AI review pack for optimization/refactoring prompts.
- Exhaustive technology audit.

Start here: [`docs/twin/README.md`](docs/twin/README.md).

## Security Notes

- Do not commit real credentials, API keys, tokens, private keys, or `.env` files.
- WebUI auth uses JWT cookies and bcrypt password hashes.
- Upload paths are validated against conversation workspaces.
- Extension routes and static assets are path-checked against extension roots.
- Extension API execution and generic IPC payloads are identified in the docs as areas for further hardening.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
