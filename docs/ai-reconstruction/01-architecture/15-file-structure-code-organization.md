# 15 - File Structure & Code Organization

## Top-level structure

```text
AionUi-Twin-main/
  src/
    index.ts                         Electron application entry
    common/                          Cross-process types, API clients, config, bridge contracts, utilities
    preload/                         Electron preload entry points
    process/                         Main process services, bridges, agents, database, webserver, workers
    renderer/                        React renderer application
  tests/
    unit/                            Node and jsdom unit tests
    integration/                     Integration tests for DB, ACP, i18n, WebUI, packaging, teams
    e2e/                             Playwright end-to-end helpers and features
    fixtures/                        Fake ACP CLI and extension fixtures
  docs/                              Existing product/spec docs plus generated AI reconstruction docs
  scripts/                           Build, packaging, i18n, benchmark, MCP, debug scripts
  resources/                         Icons and native packaging resources
  package/                           Packaging resources/docs
  mobile/                            Mobile-related package subtree
```

## Process boundary rules

| Directory            | Can use                                                          | Cannot use                                                |
| -------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `src/process`        | Node.js, Electron main APIs, filesystem, child processes, SQLite | DOM APIs, React components.                               |
| `src/renderer`       | React, DOM, browser APIs, bridge providers                       | Node fs/path/child_process, Electron main APIs.           |
| `src/preload`        | `contextBridge`, `ipcRenderer`, safe Electron utilities          | Business logic, DOM manipulation, direct database access. |
| `src/common`         | Shared types, protocol-neutral utilities, storage contracts      | Process-specific APIs unless guarded/abstracted.          |
| `src/process/worker` | Node worker/fork logic                                           | DOM/Electron window APIs.                                 |

## Naming conventions

- React components/classes: PascalCase file names.
- Utilities/hooks/constants/types: camelCase file names; hooks start with `use`.
- Renderer module directories representing specific pages/components: PascalCase.
- Category directories: lowercase.
- Platform directories: lowercase.
- Directory direct children should stay <= 10; split by responsibility as needed.

## Important module map

| Module                          | Responsibility                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/common/api`                | Rotating API clients and ClientFactory for OpenAI/Gemini/Anthropic/New API/local providers. |
| `src/common/config`             | Storage contracts, constants, app environment, i18n config, presets.                        |
| `src/common/chat`               | Message/confirmation types, approval store, document conversion, navigation interception.   |
| `src/process/bridge`            | IPC provider implementations and event emitters.                                            |
| `src/process/services/database` | SQLite schema, migrations, drivers, repositories, data conversion.                          |
| `src/process/acp`               | ACP protocol runtime, sessions, process client, errors, metrics.                            |
| `src/process/task`              | Agent manager abstraction, factory, worker task orchestration.                              |
| `src/process/channels`          | Remote assistant channel manager, plugins, actions, pairing.                                |
| `src/process/extensions`        | Extension registry, resolvers, sandbox, lifecycle, protocols.                               |
| `src/process/webserver`         | Express WebUI server, auth, middleware, routes, WebSocket bridge.                           |
| `src/renderer/pages`            | Route-level React pages.                                                                    |
| `src/renderer/hooks`            | Feature hooks for agent, assistant, chat, context, file, MCP, system, UI.                   |
| `src/renderer/utils`            | Renderer-only formatting, model, file, theme, UI helpers.                                   |

## Directory inventory snapshot

```text
src/common/adapter
src/common/api
src/common/chat
src/common/config
src/common/electronSafe.ts
src/common/index.ts
src/common/platform
src/common/types
src/common/update
src/common/utils
src/index.ts
src/preload/main.ts
src/preload/petConfirmPreload.ts
src/preload/petHitPreload.ts
src/preload/petPreload.ts
src/process/acp
src/process/agent
src/process/bridge
src/process/channels
src/process/extensions
src/process/index.ts
src/process/pet
src/process/resources
src/process/services
src/process/task
src/process/team
src/process/utils
src/process/webserver
src/process/worker
src/renderer/assets
src/renderer/components
src/renderer/hooks
src/renderer/index.html
src/renderer/main.tsx
src/renderer/pages
src/renderer/pet
src/renderer/services
src/renderer/styles
src/renderer/types.d.ts
src/renderer/utils
src/server.ts
src/types.d.ts
```

## Dependency direction

- Renderer calls `ipcBridge`; it does not import bridge implementations.
- Process bridge modules depend on repositories/services/managers, not renderer components.
- Common modules may be imported by both sides only if they are browser-safe or abstracted.
- Database repositories hide SQL from higher-level services.
- Agent managers hide fork/ACP process details from conversation bridges.

## Areas for Review

- Are any renderer files importing process-only modules through aliases in ways that bundlers currently hide?
- Which directories exceed the 10 direct-child rule and should be split next?
- Should generated documentation remain under `docs/ai-reconstruction` or be split into a separate docs package?
