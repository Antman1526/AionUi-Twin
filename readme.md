<p align="center">
  <img src="./resources/aionui_readme_header_0807.png" alt="AionUi Twin" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-32CD32?style=flat-square&logo=apache&logoColor=white" alt="License">
  &nbsp;
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6C757D?style=flat-square&logo=linux&logoColor=white" alt="Platform">
  &nbsp;
  <img src="https://img.shields.io/badge/Electron-37-007ACC?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  &nbsp;
  <img src="https://img.shields.io/badge/React-19-FF6B35?style=flat-square&logo=react&logoColor=white" alt="React">
  &nbsp;
  <img src="https://img.shields.io/badge/local%20models-first--class-8A2BE2?style=flat-square&logo=ollama&logoColor=white" alt="Local models first-class">
</p>

---

<p align="center">
  <strong>Turn command-line and API-based AI agents into a modern, local-first chat & workspace — and run your own GGUF models with one click.</strong>
</p>

<p align="center">
  A desktop-focused fork of <a href="https://github.com/iOfficeAI/AionUi">AionUi</a>, with first-class local model support.
</p>

<p align="center">
  <img src="./resources/readme-demo-assistant-write-paper.gif" alt="AionUi Twin demo" width="820">
</p>

## 📋 Table of Contents

- [🤔 What is AionUi Twin?](#-what-is-aionui-twin)
- [✨ Highlights](#-highlights)
- [🧩 Local & private by design](#-local--private-by-design)
  - [One-click local GGUF models](#one-click-local-gguf-models)
  - [No-key local servers](#no-key-local-servers)
  - [Editable model folders](#editable-model-folders)
- [📦 Install (macOS)](#-install-macos)
- [🚀 Quick start (development)](#-quick-start-development)
- [🛠️ Build from source](#️-build-from-source)
- [🏗️ Architecture](#️-architecture)
- [🧪 Verification](#-verification)
- [🙏 Acknowledgements](#-acknowledgements)
- [📄 License](#-license)

## 🤔 What is AionUi Twin?

Powerful AI lives behind command lines, raw APIs, and a dozen different model
runtimes. **AionUi Twin** brings them together in one native desktop app: a
modern chat and workspace interface that speaks to **ACP-compatible agents**
(Gemini CLI, Codex, AionRS-style workflows), **cloud providers** (OpenAI,
Anthropic, Google, Bedrock, and more), and — its defining focus — **local models
running entirely on your own machine.**

The project's intent is simple:

> **Make capable AI feel like a desktop app you own — private, offline-capable,
> and not locked to any single vendor.**

Where the upstream AionUi excels at orchestrating cloud and CLI agents, **Twin
leans into the local-first story**: it discovers the GGUF models already on your
disk and serves them with a single click, treats local OpenAI-compatible servers
as no-key first-class providers, and keeps everything — conversations, files,
config — on your device.

## ✨ Highlights

- 🧠 **Local models, one click** — discover `.gguf` files in your folders and
  launch them as chat models without touching a terminal.
- 🔌 **Bring any model** — cloud (OpenAI, Anthropic, Gemini, Bedrock, DeepSeek,
  …), local servers (Ollama, LM Studio), or raw GGUF via llama.cpp.
- 💬 **Modern chat workspace** — multi-session chat, file & project management,
  rich previews (code, Markdown, Mermaid, office docs).
- 🤝 **Teams** — multiple agents collaborating in shared or isolated workspaces.
- 🧰 **MCP tools & extensions** — connect Model Context Protocol servers and
  install skills/extensions to expand what agents can do.
- ⏰ **Scheduled prompts** — run prompts on a cron schedule.
- 🐾 **Desktop pet** — lightweight confirmations and presence on your desktop.
- 🌐 **WebUI mode** — serve the same UI over HTTP for remote/local-network access.
- 🖥️ **Cross-platform** — macOS, Windows, and Linux builds from one codebase.

## 🧩 Local & private by design

This is what sets the Twin apart. Everything below runs against models on your
own hardware — no keys, no cloud round-trips required.

### One-click local GGUF models

`Settings → Model Providers → Local GGUF Models` discovers the `.gguf` files in
your configured folders and lets you **Load** any of them with a single click:

1. AionUi Twin spawns a managed **`llama-server`** (llama.cpp) on a free loopback
   port.
2. It waits for the server to actually finish loading the model (polls `/health`,
   not just the port — large models take time).
3. It auto-registers the running model as an **OpenAI-compatible provider**, so
   it's instantly usable in chat and teams.

**Unload** stops the server. Loading a different model swaps the running one
(one model at a time, to keep memory in check). The managed provider is written
idempotently and never overwrites the providers you configured by hand.

> Requires `llama-server` on your `PATH` — install with `brew install llama.cpp`.
> It is resolved at runtime, **not bundled** in the installer, so the app stays
> small and you stay in control of your runtime.

### No-key local servers

Already running a local server? Add it in `Settings → Model Providers` and leave
the API key blank — loopback hosts are trusted automatically:

| Provider                           | Base URL                     | API key       |
| ---------------------------------- | ---------------------------- | ------------- |
| Ollama                             | `http://localhost:11434/v1`  | _leave empty_ |
| LM Studio                          | `http://localhost:1234/v1`   | _leave empty_ |
| Any OpenAI-compatible local server | `http://localhost:<port>/v1` | _leave empty_ |

Only loopback hosts may skip the key; cloud providers still require real
credentials.

### Editable model folders

The same panel lets you **add or remove the folders** that get scanned for
models (native folder picker). When none are configured, sensible defaults are
used. Adding a folder also **authorizes** loading from it — the launch path is
restricted to your configured directories, so a stray request can't run an
arbitrary file. Unmounted volumes (e.g. an external drive that's offline) are
skipped gracefully.

## 📦 Install (macOS)

Grab the latest `.dmg` from
[Releases](https://github.com/Antman1526/AionUi-Twin/releases), open it, and drag
**AionUi** to Applications.

Builds are **ad-hoc signed (not notarized)**, so the first launch needs a
Gatekeeper bypass:

- **Right-click** the app → **Open** → **Open**, _or_
- Clear the quarantine flag:
  ```bash
  xattr -dr com.apple.quarantine /Applications/AionUi.app
  ```

Verify a download against its published checksum:

```bash
shasum -a 256 AionUi-*-mac-arm64.dmg
```

## 🚀 Quick start (development)

Requires [Bun](https://bun.sh) and Node-compatible tooling.

```bash
git clone https://github.com/Antman1526/AionUi-Twin.git
cd AionUi-Twin
bun install
bun run start          # launch the desktop app in dev mode
```

Other handy commands:

```bash
bun run webui          # run the browser UI
bun run server:start   # run the WebUI server
bunx tsc --noEmit      # type-check
bun run lint           # lint
bun run test           # unit tests (Vitest)
```

## 🛠️ Build from source

Produce a distributable macOS Apple-Silicon installer:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run build-mac:arm64
# → out/AionUi-<version>-mac-arm64.dmg  (ad-hoc signed, not notarized)
```

Other targets:

```bash
bun run build-mac      # macOS arm64 + x64
bun run build-win      # Windows
bun run build-deb      # Linux (.deb)
```

> `llama-server` is **not** bundled — the local-GGUF feature resolves it from the
> user's environment at runtime, so no packaging changes are needed to ship it.

## 🏗️ Architecture

AionUi Twin is an Electron app with three strictly separated process types
(main / renderer / worker) communicating over a typed IPC bridge.

| Path           | Responsibility                                                            |
| -------------- | ------------------------------------------------------------------------- |
| `src/index.ts` | App entry: windows, tray, protocols, WebUI mode, updates, single-instance |
| `src/process`  | Main-process services, IPC bridges, database, agents, channels, workers   |
| `src/preload`  | `contextBridge` APIs for the main UI and desktop-pet windows              |
| `src/renderer` | React UI — chat, settings, teams, scheduled tasks, pet pages              |
| `src/common`   | Shared bridge contracts, config models, API clients, types, utilities     |
| `tests`        | Vitest unit/integration tests and Playwright e2e helpers                  |

**Local models** live in:

- `src/process/services/localModels/` — directory discovery + `llama-server`
  lifecycle and provider creation
- `src/process/bridge/localModelBridge.ts` — IPC handlers + provider registration
- `src/renderer/components/settings/SettingsModal/contents/LocalGgufModels.tsx`
  — the Local GGUF Models settings panel

Storage is SQLite (`better-sqlite3` or Bun's SQLite); the WebUI runs on Express +
`ws`. See `docs/` for the full reconstruction manual and PRDs.

## 🧪 Verification

Before opening a PR:

```bash
bunx tsc --noEmit
bun run lint
bun run test
prek run --from-ref origin/main --to-ref HEAD   # replicate CI checks locally
```

## 🙏 Acknowledgements

AionUi Twin is a fork of [**AionUi**](https://github.com/iOfficeAI/AionUi) by
iOfficeAI. Huge thanks to the upstream team — Twin builds on their work and adds a
local-first model story on top. Please support and star the original project.

## 📄 License

[Apache-2.0](./LICENSE) — same as upstream AionUi.
