# AionUi Twin

AionUi Twin is an Electron desktop and optional WebUI application that turns command-line and API-based AI agents into a modern chat/workspace interface. It supports ACP-compatible agents, Gemini/Codex/AionRS-style workflows, local OpenAI-compatible model servers, cloud model providers, team sessions, scheduled prompts, MCP tools, extension contributions, desktop pet confirmations, and remote assistant channels.

## Tech Stack

- Electron ^37.10.3 + electron-vite ^5.0.0
- React ^19.1.0, React Router ^7.8.0, Arco Design ^2.66.1, UnoCSS ^66.3.3
- TypeScript ^5.8.3, Bun, Vite ^6.4.1
- SQLite via better-sqlite3 ^12.4.1 or Bun SQLite
- Express ^5.1.0 + ws ^8.18.3 for WebUI mode
- OpenAI ^5.12.2, Anthropic ^0.71.2, Google GenAI ^1.16.0, ACP SDK ^0.18.2, MCP SDK ^1.20.0

## Local LLM Support

AionUi Twin includes no-key support for local OpenAI-compatible servers. Add one of these providers in Settings -> Model Providers:

| Provider  | Base URL                    | API key     |
| --------- | --------------------------- | ----------- |
| Ollama    | `http://localhost:11434/v1` | Leave empty |
| LM Studio | `http://localhost:1234/v1`  | Leave empty |

Only loopback hosts are allowed to skip API keys. Cloud providers still require real credentials.

### Seamless local GGUF models

Settings -> Model Providers also includes a **Local GGUF Models** section that
discovers `.gguf` files in your local model directories and loads them with one
click — no manual server setup. Selecting **Load** spawns a managed
`llama-server` (llama.cpp) bound to a free loopback port, waits for it to become
healthy, and auto-registers it as an OpenAI-compatible provider so the model is
usable in chat and teams immediately. **Unload** stops the server.

- Requires `llama-server` on your PATH (`brew install llama.cpp`). It is resolved
  at runtime, not bundled in the installer.
- One model is served at a time; loading another swaps it out.
- Scanned directories are editable in the same section (**Add folder** / remove).
  They default to `DEFAULT_LOCAL_MODEL_DIRECTORIES` when none are configured:
  - `/Volumes/MainStore/Development/AI_Models`
  - `/Users/Antman/Desktop/AI_Models`
- Adding a folder also authorizes loading models from it (the launch path is
  restricted to the configured directories).
- An unmounted directory (e.g. an external volume) is skipped gracefully.

## Development

```bash
cd /Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main
bun install
bun run start
```

Useful commands:

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run webui
bun run server:start
```

## Packaging

macOS ARM64 build:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run build-mac:arm64
```

Recent verified artifact:

- `/Users/Antman/Downloads/AionUi-1.9.22-mac-arm64.dmg`
- Size: 250M
- SHA-256: `c07600e622bdb1e3f40ffa619bd79c90fd9ff6643ddfc7ec2bafa602d91c6806`
- Ad-hoc signed, not notarized

## Architecture

- `src/index.ts`: Electron app entry, windows, tray, protocols, WebUI mode, updates, single-instance behavior.
- `src/process`: main process services, bridges, database, agents, extensions, channels, WebUI server, workers.
- `src/preload`: contextBridge APIs for main UI and desktop pet windows.
- `src/renderer`: React UI, settings, chat, teams, scheduled tasks, pet pages.
- `src/common`: shared bridge contracts, config models, API clients, chat/message types, utilities.
- `tests`: Vitest unit/integration tests and Playwright e2e helpers.
- `docs/ai-reconstruction`: generated technical reconstruction and audit documentation.

## Documentation

The generated reconstruction manual is in `docs/ai-reconstruction/` and mirrored locally to:

`/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-technical-docs`

Start with:

- `docs/ai-reconstruction/00-ai-audit-brief.md`
- `docs/ai-reconstruction/00-technology-inventory.md`
- `docs/ai-reconstruction/01-architecture/01-project-overview-architecture.md`

## Verification

Before committing release work, run:

```bash
bunx tsc --noEmit
bun run lint
bun run test
```

Repo policy also recommends `prek run --from-ref origin/main --to-ref HEAD` before PRs.
