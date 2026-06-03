# 01 - Project Overview & Architecture

## Purpose

AionUi Twin is an Electron desktop and optional WebUI application that turns command-line and API-based AI agents into a graphical chat/workspace environment. It supports local and cloud LLM providers, ACP-compatible CLI agents, Gemini/Codex/AionRS-style agents, team/multi-agent sessions, scheduled tasks, file/workspace operations, remote assistant channels, extension-contributed capabilities, desktop pet confirmations, and packaged native installers.

## Technology stack with exact package specifiers

| Layer        | Technologies                                                                              |
| ------------ | ----------------------------------------------------------------------------------------- |
| Runtime      | Electron ^37.10.3, Node.js, Bun, optional Bun SQLite driver                               |
| Frontend     | React ^19.1.0, React DOM ^19.1.0, React Router ^7.8.0, Arco ^2.66.1, UnoCSS ^66.3.3       |
| Main process | electron-vite ^5.0.0, better-sqlite3 ^12.4.1, Express ^5.1.0, ws ^8.18.3                  |
| AI protocols | OpenAI ^5.12.2, Anthropic ^0.71.2, Google GenAI ^1.16.0, ACP SDK ^0.18.2, MCP SDK ^1.20.0 |
| Persistence  | SQLite with WAL, versioned migrations to CURRENT_DB_VERSION 26                            |
| Testing      | Vitest ^4.0.18, Playwright ^1.58.2, Testing Library ^16.3.2, jsdom ^28.1.0                |
| Packaging    | electron-builder ^26.6.0, Electron fuses ^1.8.0, optional notarization ^3.1.0             |

## Process architecture

AionUi is split into three hard process boundaries:

- Main process under `src/process/`: owns Electron APIs, storage, SQLite, child processes, WebUI server, WebSocket bridge, extensions, channels, cron jobs, and agent runtime lifecycle.
- Preload scripts under `src/preload/`: expose a minimal `window.electronAPI`, `petAPI`, `petHitAPI`, and `petConfirmAPI` surface through Electron `contextBridge`.
- Renderer under `src/renderer/`: React application using browser APIs, `@office-ai/platform` bridge providers, and WebSocket fallback when running outside Electron.

Source: `src/process/index.ts:1`

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import '@/common/platform/register-electron';
// configureChromium sets app name (dev isolation) and Chromium flags — must run before other modules
import '@process/utils/configureChromium';

import { app } from 'electron';

// Force node-gyp-build to skip build/ directory and use prebuilds/ only in production
// This prevents loading wrong architecture binaries from development environment
// Only apply in packaged app to allow development builds to use build/Release/
if (app.isPackaged) {
  process.env.PREBUILDS_ONLY = '1';
}
import initStorage from './utils/initStorage';
import './utils/initBridge';
import './services/i18n'; // Initialize i18n for main process
import { getChannelManager } from '@process/channels';
import { ExtensionRegistry } from '@process/extensions';

export const initializeProcess = async () => {
  const t0 = performance.now();
  const mark = (label: string) => console.log(`[AionUi:process] ${label} +${Math.round(performance.now() - t0)}ms`);

  await initStorage();
  mark('initStorage');

  // Initialize Extension Registry (scan and resolve all extensions)
  try {
    await ExtensionRegistry.getInstance().initialize();
  } catch (error) {
    console.error('[Process] Failed to initialize ExtensionRegistry:', error);
    // Don't fail app startup if extensions fail to initialize
  }
```

The main process initialization calls `initStorage()`, initializes extensions, then initializes channel plugins. This ordering matters: bridges and repositories assume storage paths and SQLite are available before the renderer starts issuing IPC calls.

Source: `src/process/utils/initBridge.ts:1`

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from '../bridge';
import { SqliteChannelRepository } from '@process/services/database/SqliteChannelRepository';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { ConversationServiceImpl } from '@process/services/ConversationServiceImpl';
import { cronService } from '@process/services/cron/cronServiceSingleton';
import { workerTaskManager } from '@process/task/workerTaskManagerSingleton';
import { TeamSessionService, SqliteTeamRepository } from '@process/team';
import { initTeamGuideService } from '@process/team/mcp/guide/teamGuideSingleton';

logger.config({ print: true });

const repo = new SqliteConversationRepository();
const conversationServiceImpl = new ConversationServiceImpl(repo);
const channelRepo = new SqliteChannelRepository();
const teamRepo = new SqliteTeamRepository();
const teamSessionService = new TeamSessionService(teamRepo, workerTaskManager, conversationServiceImpl);

// 初始化所有IPC桥接
initAllBridges({
  conversationService: conversationServiceImpl,
  conversationRepo: repo,
  workerTaskManager,
  channelRepo,
  teamSessionService,
});

// Initialize cron service (load jobs from database and start timers)
void cronService.init().catch((error) => {
  console.error('[initBridge] Failed to initialize CronService:', error);
});

// Start in-process Aion MCP server for team-guide tools (aion_create_team)
void initTeamGuideService(teamSessionService).catch((error) => {
  console.error('[initBridge] Failed to initialize TeamGuideMcpServer:', error);
});
```

## Runtime component graph

1. `src/index.ts` starts Electron, applies Chromium flags, fixes PATH, initializes Sentry/logging, enforces single-instance behavior, registers `aion-asset://`, creates windows, and optionally starts WebUI mode.
2. `initializeProcess()` loads app storage, extension registry, and channel manager.
3. `initBridge.ts` constructs repository/service singletons and calls `initAllBridges()`.
4. Renderer bootstraps `common/adapter/browser`, which chooses Electron IPC or WebSocket bridge depending on `window.electronAPI`.
5. User actions call typed bridge providers from `src/common/adapter/ipcBridge.ts`; main bridge modules handle requests and emit streaming events.
6. Conversations use `WorkerTaskManager` and `AgentFactory` to create or reuse agent managers; ACP-compatible agents use `AcpRuntime` and `AcpSession`.
7. SQLite stores durable users, conversations, messages, teams, channel assistant state, cron jobs, remote agent config, and ACP session metadata.

## Architectural patterns

- Bridge-provider pattern: all renderer-main calls are named providers built by `@office-ai/platform/bridge`.
- Repository pattern: SQLite details are hidden behind interfaces such as `IConversationRepository`, `IChannelRepository`, and `ICronRepository`.
- Driver abstraction: `ISqliteDriver` allows `better-sqlite3` under Node/Electron and `bun:sqlite` under Bun.
- Agent factory: conversation `type` controls manager creation; managers own child processes or ACP sessions.
- Extension registry/resolvers: extensions contribute assistants, MCP servers, model providers, themes, webui routes, and assets.

## Reconstruction checklist

- Create the same process boundaries and path aliases: `@/*`, `@process/*`, `@renderer/*`, `@worker/*`.
- Implement `@office-ai/platform` bridge providers before building UI pages; renderer code assumes the typed bridge exists globally.
- Initialize SQLite and migrations before WebUI auth and before repositories are used.
- Keep WebUI and Electron bridge semantics equivalent: WebSocket must route the same bridge event names as Electron IPC.
- Preserve local LLM behavior: loopback OpenAI-compatible providers must not require a user API key.

## Edge cases

- Electron renderer must not import Node-only modules from `src/process` directly.
- WebUI development mode must not let app WebSocket consume Vite HMR upgrades.
- SQLite corruption recovery must not run for native module load errors.
- Agent child processes must be killed/replaced when `skipCache` rebuilds a task.

## Areas for Review

- Is the bridge-provider API surface too broad, and should it be split into capability-specific registries?
- Should `initBridge.ts` singleton construction move to a dependency injection container for testability?
- Should Electron desktop and standalone WebUI be separated into two build targets with stricter import boundaries?
