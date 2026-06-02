# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Purpose

AionUi Twin is a desktop-first AI operations interface. It turns command-line and API-backed AI agents into a modern chat, team, automation, WebUI, remote-channel, extension, and mobile-access platform. The primary app is Electron; the browser/mobile access path is Express + WebSocket; the companion mobile app is Expo/React Native.

## Core Functionality

- Chat sessions for Gemini, Aion CLI, ACP-compatible agents, Nanobot, and remote agents.
- Persistent users, conversations, messages, teams, team mailbox records, channel sessions, channel users, providers, settings, and tasks in SQLite.
- Typed-ish renderer-to-main communication through a preload IPC bridge.
- WebUI server with login, QR login, cookie JWT auth, file upload, speech-to-text upload, extension routes/assets, WebSocket traffic, and static renderer serving.
- Extension registry and channel plugins for Telegram, DingTalk, Weixin, WeCom, and extension-contributed routes.
- Built-in skills and assistants packaged into the app and copied to user-space runtime directories.
- Desktop pet windows, tray actions, update checks, PWA support, and a separate Expo mobile project.

## Process Architecture

AionUi is organized around strict runtime zones:

- `src/process/`: Electron main process. Owns Node APIs, SQLite, agent processes, WebUI server, IPC handlers, task managers, teams, channels, extensions, and packaging-sensitive runtime logic.
- `src/preload/`: Electron context bridge. Exposes a limited `window.electronAPI` API.
- `src/renderer/`: React UI. Must not import Node APIs directly.
- `mobile/`: separate Expo Router app that talks to the WebUI/API layer.

Representative startup code:

```ts
// src/process/index.ts
export const initializeProcess = async () => {
  const t0 = performance.now();
  const mark = (label: string) => console.log(`[AionUi:process] ${label} +${Math.round(performance.now() - t0)}ms`);

  await initStorage(); // data/config/cache dirs must exist before services read/write
  mark('initStorage');

  try {
    await ExtensionRegistry.getInstance().initialize(); // scan extension contributions
  } catch (error) {
    console.error('[Process] Failed to initialize ExtensionRegistry:', error);
  }
  mark('ExtensionRegistry');

  try {
    await getChannelManager().initialize(); // initialize remote messaging subsystem
  } catch (error) {
    console.error('[Process] Failed to initialize ChannelManager:', error);
  }
  mark('ChannelManager');
};
```

## IPC Composition

The renderer sends serialized requests over `ADAPTER_BRIDGE_EVENT_KEY`. Main-process bridge modules are registered from one place:

```ts
// src/process/bridge/index.ts
export function initAllBridges(deps: BridgeDependencies): void {
  initDialogBridge();
  initShellBridge();
  initFsBridge();
  initConversationBridge(deps.conversationService, deps.workerTaskManager, deps.teamSessionService);
  initApplicationBridge(deps.workerTaskManager);
  initGeminiConversationBridge(deps.workerTaskManager);
  initAuthBridge();
  initModelBridge();
  initWebuiBridge();
  initChannelBridge(deps.channelRepo);
  initDatabaseBridge(deps.conversationRepo);
  initExtensionsBridge(deps.conversationRepo, deps.workerTaskManager);
  initTeamBridge(deps.teamSessionService);
}
```

## Areas for Review

- Can `initAllBridges` become a registry with typed contracts to reduce manual registration drift?
- Should the preload bridge replace `any` payloads with Zod/TypeScript schemas?
- Should extension/channel startup failures be visible in UI health diagnostics instead of only console output?
