# AI Review Page 1: Project Overview and Architecture

AionUi Twin is an Electron + React + TypeScript desktop app that turns AI command-line agents and API model providers into a graphical chat/workspace/team automation environment. It also exposes a WebUI server for browser/mobile access and includes an Expo mobile app. The system is split into `src/process` (Electron main, database, webserver, agents), `src/preload` (contextBridge IPC), `src/renderer` (React UI), and `mobile` (Expo).

Representative startup pattern:

```ts
await initStorage();
await ExtensionRegistry.getInstance().initialize();
await getChannelManager().initialize();
```

This shows a storage-first architecture: config/data/cache directories exist before extensions, channels, built-in skills, assistants, and WebUI services load. Extension and channel init failures are logged but do not block app boot.

Cross-process bridge registration is centralized in `initAllBridges`, which wires conversation, task, auth, model, WebUI, channel, database, extensions, team, file, shell, and update IPC modules. This makes bootstrap easy to inspect but creates a single high-churn registration point.

Frontend boot wraps routes in auth, theme, preview, conversation tabs, Arco config, and conversation history providers. The renderer imports Electron Sentry only if `window.electronAPI` exists, allowing WebUI/browser mode to avoid Electron-specific protocol code.

## Areas for Review

- Can bridge registration become typed and feature-local instead of centralized?
- Is storage-first initialization robust when extensions depend on channels or channels depend on extension contributions?
- Should service health be visible in UI instead of only console logs?
